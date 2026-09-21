//! Culmin's Axum server: routing, in-memory sessions, shared types, and MCP adapter.
//!
//! Start with `cargo run` from `backend/`. See `backend/README.md` for configuration
//! and `docs/architecture.md` for data ownership and request flows.

mod agent;
mod auth;
mod gmail;

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
use tower_http::services::{ServeDir, ServeFile};

/// Common result type for API handlers and tool implementations.
type ApiResult<T> = Result<T, ApiError>;

/// An application error serialized as an HTTP status and `{ "error": "..." }`.
struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.0,
            Json(json!({
                "error":  self.1
            })),
        )
            .into_response()
    }
}

fn bad(message: &str) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, message.into())
}

fn upstream(message: &str) -> ApiError {
    ApiError(StatusCode::BAD_GATEWAY, message.into())
}

fn setting(name: &str) -> String {
    std::env::var(name).unwrap_or_default()
}

/// Cheaply cloned process state with one shared HTTP client and in-memory stores.
#[derive(Clone)]
struct AppState {
    http: reqwest::Client,
    sessions: Arc<Mutex<HashMap<String, Session>>>,
    pending: Arc<Mutex<HashMap<String, Instant>>>,
    origin: String,
}

/// Per-browser account state, removed on disconnect or lazy 24-hour expiration.
struct Session {
    access_token: String,
    refresh_token: Option<String>,
    expires: Instant,
    created: Instant,
    email: String,
    jobs: Vec<Job>,
    drafts: Vec<Value>,
    history: Vec<Value>,
    busy: bool,
}

/// A Gmail alert preview. `title` and `company` preserve Subject and From headers.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Job {
    id: String,
    title: String,
    company: String,
    description: String,
    date: String,
    source_url: String,
    #[serde(default)]
    location: String,
    #[serde(default)]
    salary: String,
    #[serde(default)]
    tags: Vec<String>,
}

fn session_id(headers: &HeaderMap) -> ApiResult<String> {
    headers
        .get(header::COOKIE)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| {
            h.split(';')
                .find_map(|p| p.trim().strip_prefix("culmin_session="))
        })
        .map(str::to_owned)
        .ok_or(ApiError(
            StatusCode::UNAUTHORIZED,
            "Connect your Google account first.".into(),
        ))
}

async fn authenticated(state: &AppState, headers: &HeaderMap) -> ApiResult<String> {
    let id = session_id(headers)?;
    let mut sessions = state.sessions.lock().await;
    sessions.retain(|_, s| s.created.elapsed() < Duration::from_secs(86400));
    if !sessions.contains_key(&id) {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "Your session expired. Connect Google again.".into(),
        ));
    }
    Ok(id)
}

async fn protect(
    State(state): State<AppState>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    if let Some(origin) = request.headers().get(header::ORIGIN)
        && origin.to_str().ok() != Some(state.origin.as_str())
    {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Origin not allowed"
            })),
        )
            .into_response();
    }
    if request.method() == axum::http::Method::POST
        && request
            .headers()
            .get("x-culmin-client")
            .and_then(|v| v.to_str().ok())
            != Some("web")
    {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Missing client header"
            })),
        )
            .into_response();
    }
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
}

async fn status(State(state): State<AppState>, headers: HeaderMap) -> Json<Value> {
    let id = authenticated(&state, &headers).await.ok();
    let sessions = state.sessions.lock().await;
    let session = id.as_ref().and_then(|i| sessions.get(i));
    Json(json!({
        "connected": session.is_some(),
        "email": session.map(|s| &s.email),
        "googleConfigured": !setting("GOOGLE_CLIENT_ID").is_empty() && !setting("GOOGLE_CLIENT_SECRET").is_empty(),
        "aiConfigured": !setting("OPENAI_API_KEY").is_empty(),
        "tools": agent::tool_definitions()
    }))
}

async fn jobs(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let id = authenticated(&state, &headers).await?;
    Ok(Json(
        agent::execute(&state, &id, "list_jobs", json!({})).await?,
    ))
}

async fn tool(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    let id = authenticated(&state, &headers).await?;
    Ok(Json(
        agent::execute(
            &state,
            &id,
            body["name"].as_str().unwrap_or(""),
            body["arguments"].clone(),
        )
        .await?,
    ))
}

async fn drafts(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    let id = authenticated(&state, &headers).await?;
    let sessions = state.sessions.lock().await;
    Ok(Json(json!({
        "drafts": sessions.get(&id).map(|s| s.drafts.clone()).unwrap_or_default()
    })))
}

// Internal, cookie-authenticated MCP endpoint using Streamable HTTP JSON responses.
// External MCP clients need the session cookie and X-Culmin-Client: web header.
async fn mcp(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Response> {
    let sid = authenticated(&state, &headers).await?;
    let id = body.get("id").cloned();
    if body["jsonrpc"] != "2.0" {
        return Ok(Json(json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": -32600,
                "message": "Invalid Request"
            }
        }))
        .into_response());
    }
    let method = body["method"].as_str().unwrap_or("");
    if id.is_none() {
        return Ok(StatusCode::ACCEPTED.into_response());
    }
    let result = match method {
        "initialize" => {
            json!({
                "protocolVersion": "2025-11-25",
                "capabilities": {
                    "tools": {
                        "listChanged": false
                    }
                },
                "serverInfo": {
                    "name": "culmin-gmail",
                    "version": "0.1.0"
                }
            })
        }
        "ping" => json!({}),
        "tools/list" => json!({
            "tools": agent::tool_definitions()
        }),
        "tools/call" => {
            let result = agent::execute(
                &state,
                &sid,
                body["params"]["name"].as_str().unwrap_or(""),
                body["params"]["arguments"].clone(),
            )
            .await;
            match result {
                Ok(v) => json!({
                    "content": [
                        {
                            "type": "text",
                            "text": v.to_string()
                        }
                    ],
                    "isError": false
                }),
                Err(e) => json!({
                    "content": [
                        {
                            "type": "text",
                            "text": e.1
                        }
                    ],
                    "isError": true
                }),
            }
        }
        _ => {
            return Ok(Json(json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": -32601,
                    "message": "Method not found"
                }
            }))
            .into_response());
        }
    };
    Ok(Json(json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    }))
    .into_response())
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    let origin = std::env::var("APP_ORIGIN").unwrap_or_else(|_| "http://localhost:5173".into());
    let state = AppState {
        http: reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .unwrap(),
        sessions: Default::default(),
        pending: Default::default(),
        origin,
    };
    let api = Router::new()
        .route(
            "/api/health",
            get(|| async {
                Json(json!({
                    "status": "ok"
                }))
            }),
        )
        .route("/api/status", get(status))
        .route("/api/auth/google", get(auth::start))
        .route("/api/auth/callback", get(auth::callback))
        .route("/api/auth/disconnect", post(auth::disconnect))
        .route("/api/jobs", get(jobs))
        .route("/api/drafts", get(drafts))
        .route("/api/tools", post(tool))
        .route("/api/chat", post(agent::chat))
        .route("/api/mcp", post(mcp))
        .layer(DefaultBodyLimit::max(128 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), protect))
        .with_state(state);
    let app = api.fallback_service(
        ServeDir::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../frontend/dist")).not_found_service(
            ServeFile::new(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../frontend/dist/index.html"
            )),
        ),
    );
    let addr = std::env::var("BIND_ADDRESS").unwrap_or_else(|_| "127.0.0.1:3000".into());
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Could not bind server address");
    println!("Culmin API listening on http://{addr}");
    axum::serve(listener, app).await.unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use tower::ServiceExt;
    fn state() -> AppState {
        AppState {
            http: reqwest::Client::new(),
            sessions: Default::default(),
            pending: Default::default(),
            origin: "http://localhost:5173".into(),
        }
    }
    fn session() -> Session {
        Session {
            access_token: "test".into(),
            refresh_token: None,
            expires: Instant::now() + Duration::from_secs(60),
            created: Instant::now(),
            email: "user@example.com".into(),
            jobs: vec![],
            drafts: vec![],
            history: vec![],
            busy: false,
        }
    }

    #[tokio::test]
    async fn cannot_access_another_session() {
        let s = state();
        s.sessions.lock().await.insert("valid".into(), session());
        let mut headers = HeaderMap::new();
        headers.insert(header::COOKIE, "culmin_session=invalid".parse().unwrap());
        assert!(authenticated(&s, &headers).await.is_err());
        headers.insert(header::COOKIE, "culmin_session=valid".parse().unwrap());
        assert_eq!(
            authenticated(&s, &headers).await.ok().as_deref(),
            Some("valid")
        );
    }

    #[tokio::test]
    async fn mcp_lists_exactly_four_tools_and_handles_calls() {
        let s = state();
        s.sessions.lock().await.insert("valid".into(), session());
        let app = Router::new().route("/api/mcp", post(mcp)).with_state(s);
        let request = Request::builder()
            .method("POST")
            .uri("/api/mcp")
            .header("content-type", "application/json")
            .header("cookie", "culmin_session=valid")
            .body(Body::from(
                r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#,
            ))
            .unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 65536).await.unwrap();
        let data: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(data["result"]["tools"].as_array().unwrap().len(), 4);
        let request = Request::builder()
            .method("POST")
            .uri("/api/mcp")
            .header("content-type", "application/json")
            .header("cookie", "culmin_session=valid")
            .body(Body::from(
                json!({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/call",
                    "params": {
                        "name": "list_jobs",
                        "arguments": {}
                    }
                })
                .to_string(),
            ))
            .unwrap();
        let response = app.oneshot(request).await.unwrap();
        let body = to_bytes(response.into_body(), 65536).await.unwrap();
        let data: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(data["result"]["isError"], false);
    }

    #[tokio::test]
    async fn rejects_cross_origin_and_missing_client_header() {
        let s = state();
        let app = Router::new()
            .route("/test", post(|| async { StatusCode::OK }))
            .layer(middleware::from_fn_with_state(s, protect));
        for origin in [Some("https://untrusted.example"), None] {
            let mut builder = Request::builder().method("POST").uri("/test");
            if let Some(origin) = origin {
                builder = builder
                    .header("origin", origin)
                    .header("x-culmin-client", "web");
            }
            let response = app
                .clone()
                .oneshot(builder.body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::FORBIDDEN);
        }
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/test")
                    .header("origin", "http://localhost:5173")
                    .header("x-culmin-client", "web")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }
}
