# Engineering documentation

Start with the [root quickstart](../README.md) to run the app. These guides describe the current implementation and distinguish working features from future work.

| Guide                                                   | Covers                                                                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [Architecture](architecture.md)                         | Components, diagrams, configuration modes, data ownership, request flows, MCP boundaries, and deployment limits.            |
| [Rust backend](../backend/README.md)                    | Modules, environment variables, authentication, HTTP contracts, state/concurrency, Gmail/MIME behavior, tests, and rustdoc. |
| [AI engineering and orchestration](ai-orchestration.md) | Tool schemas, model loop, prompting, memory, failures, authority, latency choices, and proposed evaluations.                |

## Formatting conventions

The root [EditorConfig](../.editorconfig) defines UTF-8, LF endings, final newlines, and indentation: two spaces for frontend/configuration files and four for Rust. [Prettier configuration](../.prettierrc.json) defines the frontend and Markdown style. Prettier is installed as an exact frontend development dependency; the npm lockfile captures the installed version. Rust uses the checked-in [rustfmt configuration](../backend/rustfmt.toml).

From the repository root:

```bash
# Format frontend source, configuration, and project documentation.
npm --prefix frontend run format

# Format the Rust crate.
cargo fmt --manifest-path backend/Cargo.toml
```

The frontend format script includes the docs directory and both root/backend READMEs. It ignores generated builds, dependency directories, lockfiles, and environment files. Rust macros can contain layouts that rustfmt preserves, so keep tool schemas, JSON bodies, and long request builders readable when editing them. Long prompt strings use Rust line continuations that preserve the original runtime text.

## Checks before handing off a change

```bash
npm --prefix frontend run format:check
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build

cargo fmt --manifest-path backend/Cargo.toml -- --check
cargo test --manifest-path backend/Cargo.toml
cargo clippy --manifest-path backend/Cargo.toml -- -D warnings
cargo doc --manifest-path backend/Cargo.toml --no-deps --document-private-items
```

Tests run without Google or OpenAI credentials. Passing them does not establish live provider integration or AI behavioral quality. Keep any such validation claim separate from local checks.
