//! Gmail transport, alert-to-job mapping, MIME parsing, and unsent draft creation.
//!
//! A [`Job`] represents a source email, which may describe more than one role.
//! Search retrieves metadata; details fetch the available plain-text message body.

use crate::*;
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};

async fn get(state: &AppState, token: &str, path: &str) -> ApiResult<Value> {
    let response = state
        .http
        .get(format!(
            "https://gmail.googleapis.com/gmail/v1/users/me/{path}"
        ))
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| upstream("Could not reach Gmail"))?;
    if !response.status().is_success() {
        return Err(upstream(
            "Gmail request failed. Check your connection and granted permissions.",
        ));
    }
    response
        .json()
        .await
        .map_err(|_| upstream("Invalid Gmail response"))
}

fn header_value(message: &Value, name: &str) -> String {
    message["payload"]["headers"]
        .as_array()
        .and_then(|headers| {
            headers.iter().find(|h| {
                h["name"]
                    .as_str()
                    .is_some_and(|n| n.eq_ignore_ascii_case(name))
            })
        })
        .and_then(|h| h["value"].as_str())
        .unwrap_or("")
        .to_string()
}

fn decode_body(payload: &Value, mime: &str) -> String {
    if payload["mimeType"] == mime
        && let Some(data) = payload["body"]["data"].as_str()
        && let Ok(bytes) = URL_SAFE_NO_PAD.decode(data.trim_end_matches('='))
    {
        return String::from_utf8_lossy(&bytes).into_owned();
    }
    payload["parts"]
        .as_array()
        .map(|parts| {
            parts
                .iter()
                .map(|p| decode_body(p, mime))
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

fn message_job(message: &Value) -> Job {
    let id = message["id"].as_str().unwrap_or("").to_string();
    let text = decode_body(&message["payload"], "text/plain");
    // HTML-only messages use Gmail's safe text snippet; never inject email HTML into the UI.
    let description = if text.trim().is_empty() {
        message["snippet"].as_str().unwrap_or("").to_string()
    } else {
        text.chars().take(24000).collect()
    };
    Job {
        source_url: format!("https://mail.google.com/mail/u/0/#all/{id}"),
        id,
        title: header_value(message, "Subject"),
        company: header_value(message, "From"),
        description,
        date: message["internalDate"].as_str().unwrap_or("0").into(),
        location: String::new(),
        salary: String::new(),
        tags: vec!["Gmail alert".into()],
    }
}

/// Search at most 20 alerts concurrently and merge previews into the session cache.
pub async fn search(state: &AppState, id: &str, query: &str) -> ApiResult<Value> {
    if query.len() > 500 {
        return Err(bad("Search query must be under 500 characters."));
    }
    let token = auth::access_token(state, id).await?;
    let mut url =
        reqwest::Url::parse("https://gmail.googleapis.com/gmail/v1/users/me/messages").unwrap();
    let q = if query.trim().is_empty() {
        "newer_than:30d {subject:job subject:career subject:hiring subject:opportunity \
            subject:interview}"
    } else {
        query
    };
    url.query_pairs_mut()
        .append_pair("q", q)
        .append_pair("maxResults", "20");
    let response = state
        .http
        .get(url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|_| upstream("Could not search Gmail"))?;
    if !response.status().is_success() {
        return Err(upstream("Gmail search failed. Check your connection."));
    }
    let body: Value = response
        .json()
        .await
        .map_err(|_| upstream("Invalid Gmail search response"))?;
    let mut tasks = tokio::task::JoinSet::new();
    for item in body["messages"].as_array().into_iter().flatten() {
        let Some(message_id) = item["id"].as_str() else {
            continue;
        };
        let state = state.clone();
        let token = token.clone();
        let path = format!("messages/{message_id}?format=metadata");
        tasks.spawn(async move { get(&state, &token, &path).await.map(|v| message_job(&v)) });
    }
    let mut jobs = vec![];
    let mut failed = 0;
    while let Some(result) = tasks.join_next().await {
        match result {
            Ok(Ok(job)) => jobs.push(job),
            _ => failed += 1,
        }
    }
    if jobs.is_empty() && failed > 0 {
        return Err(upstream(
            "Could not load matching Gmail alerts. Try searching again.",
        ));
    }
    jobs.sort_by(|a: &Job, b: &Job| {
        b.date
            .parse::<u64>()
            .unwrap_or(0)
            .cmp(&a.date.parse::<u64>().unwrap_or(0))
    });
    if let Some(session) = state.sessions.lock().await.get_mut(id) {
        for job in &jobs {
            if let Some(old) = session.jobs.iter_mut().find(|j| j.id == job.id) {
                *old = job.clone();
            } else {
                session.jobs.push(job.clone());
            }
        }
        session.jobs.sort_by(|a, b| {
            b.date
                .parse::<u64>()
                .unwrap_or(0)
                .cmp(&a.date.parse::<u64>().unwrap_or(0))
        });
        session.jobs.truncate(200);
    }
    Ok(json!({
        "jobs": jobs,
        "failed": failed,
        "hasMore": body.get("nextPageToken").is_some(),
        "note": "Each item is a source email and may contain multiple roles. Search returns up \
            to 20 alerts; refine the query for more specific results."
    }))
}

/// Fetch a source email by hexadecimal message ID without updating cached previews.
pub async fn details(state: &AppState, id: &str, job_id: &str) -> ApiResult<Value> {
    if job_id.is_empty() || !job_id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(bad("Invalid Gmail job ID."));
    }
    let token = auth::access_token(state, id).await?;
    let message = get(state, &token, &format!("messages/{job_id}?format=full")).await?;
    Ok(json!({ "job": message_job(&message) }))
}

/// Validate draft fields and encode a UTF-8 MIME message as unpadded base64url.
pub fn raw_email(to: &str, subject: &str, body: &str) -> ApiResult<String> {
    if to.is_empty()
        || to.len() > 254
        || !to.contains('@')
        || to
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || ",;<>".contains(c))
    {
        return Err(bad("Enter one valid recipient email address."));
    }
    if subject.trim().is_empty() || subject.len() > 500 || subject.chars().any(|c| c.is_control()) {
        return Err(bad("Enter a valid subject without line breaks."));
    }
    if body.trim().is_empty() || body.len() > 30000 {
        return Err(bad("Draft body must be between 1 and 30,000 bytes."));
    }
    let subject = STANDARD.encode(subject.as_bytes());
    let encoded_body = STANDARD.encode(body.as_bytes());
    let wrapped = encoded_body
        .as_bytes()
        .chunks(76)
        .map(|s| std::str::from_utf8(s).unwrap())
        .collect::<Vec<_>>()
        .join("\r\n");
    Ok(URL_SAFE_NO_PAD.encode(format!(
        "To: {to}\r\n\
         Subject: =?UTF-8?B?{subject}?=\r\n\
         MIME-Version: 1.0\r\n\
         Content-Type: text/plain; charset=UTF-8\r\n\
         Content-Transfer-Encoding: base64\r\n\
         \r\n\
         {wrapped}"
    )))
}

/// Create an unsent Gmail draft and record its returned ID in the current session.
///
/// This write is not retried automatically: a timeout can leave its outcome unknown.
pub async fn draft(state: &AppState, id: &str, args: &Value) -> ApiResult<Value> {
    let to = args["to"].as_str().unwrap_or("");
    let subject = args["subject"].as_str().unwrap_or("");
    let body = args["body"].as_str().unwrap_or("");
    let raw = raw_email(to, subject, body)?;
    let token = auth::access_token(state, id).await?;
    let response = state
        .http
        .post("https://gmail.googleapis.com/gmail/v1/users/me/drafts")
        .bearer_auth(token)
        .json(&json!({
            "message": {
                "raw": raw
            }
        }))
        .send()
        .await
        .map_err(|_| {
            upstream("Gmail draft status is unknown. Check Gmail Drafts before retrying.")
        })?;
    if !response.status().is_success() {
        return Err(upstream(
            "Gmail could not create the draft. Check Gmail Drafts before retrying.",
        ));
    }
    let created: Value = response.json().await.map_err(|_| {
        upstream("Draft may have been created. Check Gmail Drafts before retrying.")
    })?;
    let draft = json!({
        "id": created["id"],
        "to": to,
        "subject": subject,
        "body": body,
        "url": "https://mail.google.com/mail/u/0/#drafts"
    });
    if let Some(session) = state.sessions.lock().await.get_mut(id) {
        session.drafts.push(draft.clone());
    }
    Ok(json!({
        "draft": draft,
        "message": "Draft created in Gmail. No email was sent."
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_header_injection() {
        assert!(raw_email("a@b.com\r\nBcc: c@d.com", "Hello", "Body").is_err());
        assert!(raw_email("a@b.com", "Hello\nBcc: c@d.com", "Body").is_err());
    }

    #[test]
    fn preserves_unicode_mime() {
        let raw = raw_email("a@b.com", "Hello 👋", "Kumusta, José!")
            .ok()
            .unwrap();
        let decoded = String::from_utf8(URL_SAFE_NO_PAD.decode(raw).unwrap()).unwrap();
        assert!(decoded.contains("Content-Transfer-Encoding: base64"));
        assert!(decoded.ends_with(&STANDARD.encode("Kumusta, José!")));
    }

    #[test]
    fn extracts_nested_plain_text() {
        let p = json!({
            "mimeType": "multipart/mixed",
            "parts": [
                {
                    "mimeType": "multipart/alternative",
                    "parts": [
                        {
                            "mimeType": "text/plain",
                            "body": {
                                "data": URL_SAFE_NO_PAD.encode("Job description")
                            }
                        }
                    ]
                }
            ]
        });
        assert_eq!(decode_body(&p, "text/plain"), "Job description");
    }
}
