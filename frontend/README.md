# Culmin frontend

React 19 + TypeScript + Vite. See [the project README](../README.md) for Google OAuth, AI configuration, architecture, and current limitations.

```bash
npm install
npm run dev
```

Open http://localhost:5173. The Rust backend runs on port 3000 by default. You can explore the demo without credentials.

```bash
npm test
npm run lint
npm run build
```

Set `API_TARGET=http://127.0.0.1:3001` when running the backend on another port.

## Formatting and engineering guides

Use `npm run format` to format the frontend and project documentation, and `npm run format:check` to verify them without changes. Rust formatting is handled separately with `cargo fmt` in `backend/`.

See the [engineering documentation index](../docs/README.md), [architecture](../docs/architecture.md), and [AI orchestration guide](../docs/ai-orchestration.md) for implementation details.
