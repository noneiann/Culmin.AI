# Culmin.AI

A fast, chat-centered job-search workspace built with React 19, Vite, and Rust/Axum. Google OAuth connects your Gmail job alerts to a four-tool agent. The UI provides opportunities, bookmarks, Gmail drafts, and a local interview planner.

## Documentation

- [Architecture](docs/architecture.md): system diagrams, operating modes, data ownership, and deployment.
- [Rust backend](backend/README.md): modules, OAuth, endpoints, concurrency, and Gmail operations.
- [AI engineering and orchestration](docs/ai-orchestration.md): tool contracts, the model loop, memory, safety boundaries, and evaluations.
- [Formatting and engineering workflow](docs/README.md): repeatable format commands and checks.

With no credentials configured, the UI shows placeholder jobs and scripted demo chat. It does not access Gmail or OpenAI. Google sign-in alone enables live Gmail tools; AI chat additionally requires an OpenAI key.

## Run locally

You need Node.js and a current Rust toolchain. No credentials are needed to explore the clearly labeled demo workspace.

Terminal 1:

```bash
cd backend
cp .env.example .env
cargo run
```

Terminal 2:

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. The frontend proxies `/api` to the Rust server on port 3000. Use the exact origin configured in `APP_ORIGIN` for OAuth and authenticated writes.

If port 3000 is already in use, run the backend with `BIND_ADDRESS=127.0.0.1:3001 cargo run` and the frontend with `API_TARGET=http://127.0.0.1:3001 npm run dev`. No existing processes need to be stopped.

## Connect Google and enable AI

1. Create a project in Google Cloud and enable the **Gmail API**.
2. Configure the OAuth consent screen. For a personal development project, add your Gmail address as a test user.
3. Create an OAuth client of type **Web application**. Add this exact authorized redirect URI: `http://localhost:5173/api/auth/callback`.
4. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `backend/.env`.
5. Add `OPENAI_API_KEY` to enable chat. `OPENAI_MODEL` is configurable and defaults to `gpt-4.1-mini`. Direct Gmail search, details, and draft creation work without an AI key.
6. Restart the backend, open the workspace, and choose **Connect Google**.

The app requests `gmail.readonly` and `gmail.compose`. Google's compose scope also permits sending; **the application does not expose or implement a send action**. Drafts are created in Gmail for manual review. Relevant Gmail content is sent to OpenAI when using the agent. Google may require OAuth verification before this app can be made available broadly; personal testing is supported through consent-screen test users.

Secrets and Google tokens stay on the backend. `.env` is ignored by Git. Do not put credentials in frontend environment variables.

## Four tools

| Tool                 | Behavior                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `search_jobs`        | Searches Gmail using Gmail query syntax; concurrently loads up to 20 alert previews and caches them in the user's session. |
| `list_jobs`          | Lists previously discovered alerts in the current session.                                                                 |
| `get_job`            | Fetches the available full plain-text content of a source alert. HTML-only messages use the safe Gmail snippet.            |
| `create_email_draft` | Creates an unsent Gmail draft with a recipient, subject, and body.                                                         |

A Gmail alert may contain multiple roles. The UI preserves the alert subject and sender rather than inventing a job title, company, compensation, or fit score. The agent can read the alert and explain its roles. Narrow Gmail queries when there are more than 20 results, for example:

```text
newer_than:14d (subject:job OR subject:hiring) (React OR TypeScript) remote
```

The chat agent uses the OpenAI Responses API with a bounded six-round tool loop. Tools run in process for low overhead, using the same registry and implementation exposed through MCP. Tool completion traces appear below the agent's reply. AI replies are returned after the tool loop completes; token streaming is not implemented.

## MCP and API

`POST /api/mcp` is an **internal, authenticated Streamable HTTP endpoint** using MCP protocol version `2025-11-25` with JSON responses. It supports `initialize`, `ping`, `tools/list`, and `tools/call`; notifications return HTTP 202. GET streaming is not supported.

This endpoint uses the application's Google-authenticated session cookie and requires `X-Culmin-Client: web` for POST requests. It is intended for first-party use; it is not a public remote MCP service with MCP OAuth discovery. The web agent uses the shared dispatcher in process, so no additional network hop is required. Exposing it to independent remote clients would require a separate standards-compliant authorization layer.

Other endpoints:

- `GET /api/health`, `GET /api/status`
- `GET /api/auth/google`, `GET /api/auth/callback`, `POST /api/auth/disconnect`
- `GET /api/jobs`, `GET /api/drafts`
- `POST /api/tools` with `{ "name": "search_jobs", "arguments": { "query": "..." } }`
- `POST /api/chat` with `{ "message": "Find remote frontend roles in my recent job alerts" }`

The backend validates the browser Origin, uses HttpOnly SameSite cookies, verifies single-use OAuth state tied to the initiating browser, refreshes Google access tokens, isolates sessions, limits request sizes, and guards against overlapping agent runs. Email content is treated as untrusted data and is never rendered as HTML. Draft MIME headers reject control characters.

## Current scope

This is a runnable local MVP, with live integrations ready for your credentials:

- Google tokens, discovered alerts, chat history, and the list of created drafts are **in server memory**, scoped to a 24-hour session. Restarting the backend requires reconnecting Google. The underlying Gmail drafts remain in Gmail.
- Bookmarks and calendar events are stored in this browser and separated by account. Demo drafts are stored only in the browser. Calendar events do not sync to Google Calendar.
- The drafts view lists drafts created during this session, not every draft already in Gmail.
- A search retrieves up to 20 alerts; the session keeps up to 200 discovered alerts. The UI filter searches loaded results; ask the agent to search Gmail for new ones, or use Refresh jobs for recent alerts.
- Demo jobs are illustrative, not verified vacancies. Demo chat uses simple local responses and never claims to have run real AI or Gmail tools.
- Live Google consent, Gmail requests, and OpenAI calls require your credentials and have not been exercised with a real account here.
- Production use would need a durable encrypted token/session store, deployment rate limits, appropriate Google OAuth verification, and operational monitoring.

## Checks

```bash
cd frontend
npm run format:check
npm test
npm run lint
npm run build

cd ../backend
cargo fmt -- --check
cargo test
cargo clippy -- -D warnings
```

Frontend tests exercise filtering, bookmark persistence, drafting, calendar event creation/removal, demo chat, and separation of live versus demo data. Rust tests cover MIME generation, header-injection rejection, nested MIME parsing, session isolation, MCP listing/calling, and Origin/client-header enforcement.

For a local production build, run `npm run build` in `frontend`, then set `APP_ORIGIN=http://localhost:3000` in `backend/.env`, add `http://localhost:3000/api/auth/callback` to Google's authorized redirects, and run the backend. Axum serves the compiled frontend. Use HTTPS and a matching `APP_ORIGIN` for a deployed host; HTTPS enables Secure cookies.

## Implementation references

- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [Google OAuth for web server applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Gmail drafts](https://developers.google.com/workspace/gmail/api/guides/drafts)
- [MCP Streamable HTTP, 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
