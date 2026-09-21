//! Google OAuth, browser-bound state validation, access-token refresh, and logout.
//!
//! Tokens remain in the server's in-memory session store. See `backend/README.md`
//! for the cookie lifetime and deployment assumptions.

use crate::*;
use axum::{extract::Query, response::Redirect};
use uuid::Uuid;

fn callback_url(state: &AppState) -> String {
    format!("{}/api/auth/callback", state.origin)
}

fn cookie(state: &AppState, name: &str, value: &str, age: u32) -> String {
    format!(
        "{name}={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={age}{}",
        if state.origin.starts_with("https://") {
            "; Secure"
        } else {
            ""
        }
    )
}

/// Create a ten-minute OAuth state nonce and redirect to Google's consent page.
pub async fn start(State(state): State<AppState>) -> ApiResult<Response> {
    let client = setting("GOOGLE_CLIENT_ID");
    if client.is_empty() || setting("GOOGLE_CLIENT_SECRET").is_empty() {
        return Err(bad(
            "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET \
            in backend/.env.",
        ));
    }
    let nonce = Uuid::new_v4().to_string();
    let mut pending = state.pending.lock().await;
    pending.retain(|_, time| time.elapsed() < Duration::from_secs(600));
    pending.insert(nonce.clone(), Instant::now());
    let mut url = reqwest::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
    url.query_pairs_mut().extend_pairs([
        ("client_id", client.as_str()),
        ("redirect_uri", callback_url(&state).as_str()),
        ("response_type", "code"),
        (
            "scope",
            "https://www.googleapis.com/auth/gmail.readonly \
             https://www.googleapis.com/auth/gmail.compose",
        ),
        ("state", nonce.as_str()),
        ("access_type", "offline"),
        ("prompt", "consent"),
    ]);
    let mut response = Redirect::to(url.as_str()).into_response();
    response.headers_mut().append(
        header::SET_COOKIE,
        cookie(&state, "culmin_oauth", &nonce, 600).parse().unwrap(),
    );
    Ok(response)
}

/// Exchange a browser-bound, single-use authorization code flow for a session.
pub async fn callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> ApiResult<Response> {
    if params.contains_key("error") {
        return Ok(Redirect::to(&format!("{}/?connection=denied", state.origin)).into_response());
    }
    let nonce = params
        .get("state")
        .ok_or_else(|| bad("Missing OAuth state"))?;
    let browser_nonce = headers
        .get(header::COOKIE)
        .and_then(|h| h.to_str().ok())
        .and_then(|h| {
            h.split(';')
                .find_map(|p| p.trim().strip_prefix("culmin_oauth="))
        });
    if browser_nonce != Some(nonce.as_str()) {
        return Err(bad(
            "OAuth state does not match this browser. Please reconnect.",
        ));
    }
    let created = state
        .pending
        .lock()
        .await
        .remove(nonce)
        .ok_or_else(|| bad("OAuth session expired"))?;
    if created.elapsed() > Duration::from_secs(600) {
        return Err(bad("OAuth session expired"));
    }
    let code = params
        .get("code")
        .ok_or_else(|| bad("Missing authorization code"))?;
    let result = state
        .http
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("code", code.clone()),
            ("client_id", setting("GOOGLE_CLIENT_ID")),
            ("client_secret", setting("GOOGLE_CLIENT_SECRET")),
            ("redirect_uri", callback_url(&state)),
            ("grant_type", "authorization_code".into()),
        ])
        .send()
        .await
        .map_err(|_| upstream("Could not contact Google"))?;
    if !result.status().is_success() {
        return Err(upstream("Google authorization failed. Please reconnect."));
    }
    let token: Value = result
        .json()
        .await
        .map_err(|_| upstream("Invalid Google token response"))?;
    let access_token = token["access_token"]
        .as_str()
        .ok_or_else(|| upstream("Google did not return an access token"))?
        .to_string();
    let profile: Value = state
        .http
        .get("https://gmail.googleapis.com/gmail/v1/users/me/profile")
        .bearer_auth(&access_token)
        .send()
        .await
        .map_err(|_| upstream("Could not read Gmail profile"))?
        .error_for_status()
        .map_err(|_| {
            upstream(
                "Gmail access was not granted. Enable the Gmail API and grant both \
                 requested permissions.",
            )
        })?
        .json()
        .await
        .map_err(|_| upstream("Invalid Gmail profile"))?;
    let id = Uuid::new_v4().to_string();
    state.sessions.lock().await.insert(
        id.clone(),
        Session {
            access_token,
            refresh_token: token["refresh_token"].as_str().map(str::to_owned),
            expires: Instant::now()
                + Duration::from_secs(
                    token["expires_in"]
                        .as_u64()
                        .unwrap_or(3600)
                        .saturating_sub(60),
                ),
            created: Instant::now(),
            email: profile["emailAddress"].as_str().unwrap_or("").into(),
            jobs: vec![],
            drafts: vec![],
            history: vec![],
            busy: false,
        },
    );
    let mut response =
        Redirect::to(&format!("{}/?connection=success", state.origin)).into_response();
    response.headers_mut().append(
        header::SET_COOKIE,
        cookie(&state, "culmin_session", &id, 86400)
            .parse()
            .unwrap(),
    );
    response.headers_mut().append(
        header::SET_COOKIE,
        cookie(&state, "culmin_oauth", "", 0).parse().unwrap(),
    );
    Ok(response)
}

/// Return the cached token, refreshing it before expiry when a refresh token exists.
pub async fn access_token(state: &AppState, id: &str) -> ApiResult<String> {
    let refresh = {
        let sessions = state.sessions.lock().await;
        let s = sessions
            .get(id)
            .ok_or_else(|| ApiError(StatusCode::UNAUTHORIZED, "Reconnect Google.".into()))?;
        if s.expires > Instant::now() {
            return Ok(s.access_token.clone());
        }
        s.refresh_token.clone().ok_or_else(|| {
            ApiError(
                StatusCode::UNAUTHORIZED,
                "Google session expired. Reconnect your account.".into(),
            )
        })?
    };
    let response = state
        .http
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh.as_str()),
            ("client_id", setting("GOOGLE_CLIENT_ID").as_str()),
            ("client_secret", setting("GOOGLE_CLIENT_SECRET").as_str()),
        ])
        .send()
        .await
        .map_err(|_| upstream("Could not refresh Google access"))?;
    if !response.status().is_success() {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "Google access expired. Reconnect your account.".into(),
        ));
    }
    let token: Value = response
        .json()
        .await
        .map_err(|_| upstream("Invalid Google response"))?;
    let access = token["access_token"]
        .as_str()
        .ok_or_else(|| upstream("Missing Google token"))?
        .to_string();
    if let Some(s) = state.sessions.lock().await.get_mut(id) {
        s.access_token = access.clone();
        s.expires = Instant::now()
            + Duration::from_secs(
                token["expires_in"]
                    .as_u64()
                    .unwrap_or(3600)
                    .saturating_sub(60),
            );
    }
    Ok(access)
}

/// Remove the local session, attempt Google token revocation, and clear the cookie.
pub async fn disconnect(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Response> {
    let id = authenticated(&state, &headers).await?;
    let session = state.sessions.lock().await.remove(&id);
    // Local session is always removed, even if Google's revocation endpoint is unavailable.
    let revoked = if let Some(s) = session {
        state
            .http
            .post("https://oauth2.googleapis.com/revoke")
            .form(&[("token", s.refresh_token.unwrap_or(s.access_token))])
            .send()
            .await
            .is_ok_and(|r| r.status().is_success())
    } else {
        false
    };
    let mut response = Json(json!({
        "connected": false,
        "revoked": revoked
    }))
    .into_response();
    response.headers_mut().append(
        header::SET_COOKIE,
        cookie(&state, "culmin_session", "", 0).parse().unwrap(),
    );
    Ok(response)
}
