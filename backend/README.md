# Rust backend

The backend is a single Rust binary built with Axum and Tokio. It owns Google credentials, browser sessions, Gmail operations, the AI tool loop, and the internal MCP adapter. The frontend receives application data and connection status, never Google access tokens or the OpenAI key.

See [architecture](../docs/architecture.md) for the system view and [AI orchestration](../docs/ai-orchestration.md) for model behavior. This document describes the implementation in this repository, including its current limits.

## Run and configure

From `backend/`:

```bash
cp .env.example .env
cargo run
```

Copy the example only when you do not already have a `.env`. `dotenvy` loads configuration at startup from the working directory or its ancestors; existing process environment variables take precedence. Restart the process after changing configuration. No `.env` file is required for the frontend's sample workspace.

| Variable               | Default                    | Purpose                                                                  |
| ---------------------- | -------------------------- | ------------------------------------------------------------------------ |
| `BIND_ADDRESS`         | `127.0.0.1:3000`           | Backend listener.                                                        |
| `APP_ORIGIN`           | `http://localhost:5173`    | Exact allowed browser origin and OAuth callback base. No trailing slash. |
| `GOOGLE_CLIENT_ID`     | Unset                      | Google web-application OAuth client ID.                                  |
| `GOOGLE_CLIENT_SECRET` | Unset                      | Server-side OAuth client secret.                                         |
| `OPENAI_API_KEY`       | Unset                      | Enables authenticated AI chat.                                           |
| `OPENAI_MODEL`         | `gpt-4.1-mini` when absent | Model identifier used for Responses API calls.                           |

Google OAuth setup is covered in the [root quickstart](../README.md#connect-google-and-enable-ai). Leave unused keys unset; an explicitly empty `OPENAI_MODEL` does not select the fallback.

For a busy port:

```bash
BIND_ADDRESS=127.0.0.1:3001 cargo run
```

Run Vite with `API_TARGET=http://127.0.0.1:3001 npm run dev` in a second terminal. `API_TARGET` belongs to Vite and is not loaded from the backend's `.env`.

## Source map

| File                           | Responsibilities                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| [`src/main.rs`](src/main.rs)   | Shared state and types, routing, request protection, API errors, MCP adapter, static frontend serving, and handler tests. |
| [`src/auth.rs`](src/auth.rs)   | Consent redirect, callback validation, token exchange/refresh, and disconnect.                                            |
| [`src/gmail.rs`](src/gmail.rs) | Gmail HTTP calls, concurrent alert loading, MIME parsing/encoding, and draft creation.                                    |
| [`src/agent.rs`](src/agent.rs) | Four-tool registry, shared dispatcher, chat admission, and bounded model loop.                                            |

The modules share types from the crate root. The binary has no database, job queue, ORM, or external agent framework.

## State and ownership

`AppState` is cloned into handlers. Its `reqwest::Client` shares connection pools; its two `Arc<Mutex<HashMap<...>>>` fields share sessions and pending OAuth nonces. The HTTP client has a 60-second timeout per outbound request.

A `Session` contains:

- Google access token, optional refresh token, token expiry, account email, and session creation time.
- Discovered `Job` previews, drafts created through this session, and model conversation items.
- A `busy` flag used to admit only one `/api/chat` run per session.

Handlers generally clone needed data and release the session mutex before awaiting network requests. Gmail search spawns a Tokio `JoinSet` task for each of up to 20 returned message IDs. The mutex is shared across sessions, so future handlers must keep lock-held work short. Token refreshes are not coalesced; simultaneous requests may refresh the same expired token independently.

Session expiry is a fixed 24 hours from creation, not a sliding idle timeout. Expired entries are removed lazily during authenticated requests. Pending OAuth nonces expire after ten minutes and are pruned when another login starts. There is no background cleanup task or durable storage. Restarting the server loses tokens and session data.

## Google authentication lifecycle

1. `GET /api/auth/google` checks that both Google credentials are nonempty.
2. It creates a UUID state nonce, stores its creation time, and sets the `culmin_oauth` cookie for 600 seconds.
3. Google consent requests Gmail read and compose scopes, offline access, and a callback at `${APP_ORIGIN}/api/auth/callback`.
4. The callback requires its state to match the browser cookie and an unexpired server entry. The server removes that entry before exchanging the code, making it single-use.
5. The server exchanges the code, reads the Gmail profile, creates a new session, and sets `culmin_session` for 86,400 seconds. It clears the OAuth cookie and redirects to the UI.
6. Before Gmail operations, `access_token` refreshes an expired token when a refresh token is available. The cached expiry includes a 60-second margin.
7. Disconnect removes the local session first, attempts Google revocation, clears the session cookie, and returns whether revocation succeeded.

Both cookies use `HttpOnly`, `SameSite=Lax`, and `Path=/`. `Secure` is added when `APP_ORIGIN` begins with `https://`. The callback handles denied consent by redirecting with `?connection=denied`.

## HTTP contract

All POST requests need `X-Culmin-Client: web`. When an `Origin` header is present, it must exactly match `APP_ORIGIN`; a missing Origin is accepted. Protected data also requires a valid `culmin_session` cookie. The client header is a request-validation convention, not an authentication credential.

| Method and route            | Session required | Result                                                                                   |
| --------------------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `GET /api/health`           | No               | `{ "status": "ok" }`; does not probe providers.                                          |
| `GET /api/status`           | No               | Connection/configuration flags, optional account email, and tool definitions.            |
| `GET /api/auth/google`      | No               | Consent redirect and OAuth state cookie.                                                 |
| `GET /api/auth/callback`    | OAuth state      | Code exchange and session redirect.                                                      |
| `POST /api/auth/disconnect` | Yes              | `{ "connected": false, "revoked": boolean }`.                                            |
| `GET /api/jobs`             | Yes              | `{ "jobs": [...] }` from the current session cache.                                      |
| `GET /api/drafts`           | Yes              | `{ "drafts": [...] }` created in this session.                                           |
| `POST /api/tools`           | Yes              | Dispatches `{ "name": "...", "arguments": {...} }`.                                      |
| `POST /api/chat`            | Yes, plus AI key | Accepts `{ "message": "..." }`; returns final text and tool traces.                      |
| `POST /api/mcp`             | Yes              | Internal JSON-RPC adapter; see [MCP architecture](../docs/architecture.md#mcp-boundary). |

For example, the browser submits this body to `/api/tools` when searching:

```json
{
  "name": "search_jobs",
  "arguments": {
    "query": "newer_than:14d subject:job remote"
  }
}
```

Application errors use `{ "error": "message" }`. They distinguish invalid input (400), missing/expired session (401), Origin/client-header rejection (403), overlapping chat runs (409), upstream failures (502), and missing AI configuration (503). Axum extraction errors, such as malformed JSON or oversized bodies, can use Axum's own response shape. Request bodies are limited to 128 KiB. Responses that pass through the protection middleware's downstream path receive `Cache-Control: no-store`; early middleware rejections return before that header is added.

`/api/status` checks configuration presence, not credential validity. A connected status means an application session exists, not that Google has just revalidated its tokens.

## Gmail data model

`Job` is serialized with camelCase field names. Live records map Gmail fields as follows:

| App field            | Gmail source                                                                  |
| -------------------- | ----------------------------------------------------------------------------- |
| `id`                 | Message ID.                                                                   |
| `title`              | Subject header.                                                               |
| `company`            | From header, which can identify an alert service rather than an employer.     |
| `description`        | Snippet for metadata results; decoded plain text for details, when available. |
| `date`               | `internalDate`, retained as a milliseconds-since-epoch string.                |
| `sourceUrl`          | Gmail message link using the message ID.                                      |
| `location`, `salary` | Empty for live alerts; not inferred by the adapter.                           |
| `tags`               | `["Gmail alert"]`.                                                            |

Search uses `format=metadata`, sorts newest first, merges by message ID, and retains the newest 200 previews. Its response includes `failed`, `hasMore`, and a note explaining that one email can contain multiple roles. There is no pagination cursor API; refine the query to narrow results.

Details use `format=full`, recurse through MIME parts for `text/plain`, and limit decoded descriptions to 24,000 Unicode characters. Missing plain text falls back to Gmail's snippet. The adapter does not sanitize/render HTML or fetch separately stored body attachments. Details do not replace the cached preview.

## Draft encoding and validation

`raw_email` rejects empty or oversized fields, whitespace/control characters and several address separators in recipients, and control characters in subjects. Recipient validation is basic and does not verify mailbox existence. Length checks use Rust string byte lengths:

| Input        | Limit                                                  |
| ------------ | ------------------------------------------------------ |
| Search query | 500 bytes, although the error message says characters. |
| Recipient    | 254 bytes.                                             |
| Subject      | 500 bytes.                                             |
| Draft body   | 30,000 bytes.                                          |
| Chat message | 12,000 bytes.                                          |

The subject is a UTF-8 base64 encoded-word. The text body is base64 wrapped at 76 columns. The complete MIME message uses CRLF separators and is encoded as unpadded base64url for Gmail.

Draft creation performs one POST to Gmail's drafts endpoint. No send endpoint exists. A timeout can occur after Gmail accepted the write; the error asks the user to inspect Gmail Drafts before retrying. There is no idempotency key, automatic retry, or exactly-once guarantee.

## Formatting, tests, and generated reference

From `backend/`:

```bash
cargo fmt
cargo fmt -- --check
cargo test
cargo clippy -- -D warnings
cargo doc --no-deps --document-private-items
```

Open `target/doc/backend/index.html` for generated Rust documentation. The six existing tests cover session isolation, Origin/client-header checks, MCP tool listing/calling, MIME header injection, Unicode body encoding, and nested plain-text extraction. They do not exercise real Google consent, token refresh, Gmail writes, or OpenAI calls.

[`rustfmt.toml`](rustfmt.toml) sets Rust 2024 formatting and a 100-column target. Tool schemas and request builders are expanded manually where macro formatting would otherwise leave them dense. Formatting and documentation updates are intended to preserve runtime behavior.

## Serving a production build

Build the frontend with `npm run build`. Axum serves `frontend/dist` using a path derived from the crate's compile-time manifest directory and falls back to `index.html` for client routes. A packaged binary therefore needs that build path to remain valid, or the static-file path must be made configurable before packaging it elsewhere.

Set `APP_ORIGIN` to the actual browser origin and register the matching callback with Google. For anything beyond local use, the current gaps include encrypted durable token storage, shared sessions across instances, rate limits, provider-level integration tests, and operational monitoring. See [architecture](../docs/architecture.md#deployment-and-current-limits).
