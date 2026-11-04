# Change Log

All notable changes to the "Arc Database Manager" extension will be documented in this file.

## [Unreleased]

### Added
- Database lifecycle from the Explorer: first-class database and scoped measurement listing APIs, create, and confirmed delete (admin token; server deletion must be enabled).

### Fixed
- **A refused database listing no longer looks like an empty server.** Arc restricts a token's reads per database, and refuses to list every database for a scoped token rather than returning a partial list — the same bar `SHOW DATABASES` applies. `getDatabases()` answered *any* request failure by returning `['default']`, so a refusal put a database in the explorer that the token might not be able to read, with nothing anywhere saying the token had been refused. Refusals now surface: the explorer shows the connection's own database when one is set, and otherwise one node saying the token is scoped and that a database has to be set. The lenient `['default']` fallback stays for an unreachable server, which is a different problem.
- **Arc's 401 and 403 are no longer one message.** 403 alone is Arc's answer to four different things — a token with no read permission, a token whose grants do not cover the database asked for, a licence-gated feature, and Arc's own permission store being unreadable — distinguishable only by message. Each now produces a sentence naming the fix, so a scoped token is never reported as a bad token and a server fault is never reported as a permissions problem.
- **A refusal is no longer retried against a second endpoint.** `getMeasurements()` fell back from `SHOW TABLES` to `/api/v1/measurements` on any failure; that endpoint applies the same per-database check and answers identically, so the retry only doubled the requests and the audit entries for a decision Arc had already made. The fallback still runs for other failures.
- **SQL completions survive a scoped token.** The completion cache was emptied whenever `SHOW DATABASES` failed, costing a scoped token every completion it could still have had; it now seeds from the connection's database instead.

### Added
- **Token permissions are chosen, not assumed.** Creating a token asks which of `read`, `write`, `delete` and `admin` it should carry, defaulting to Arc's own `read,write`. The created-token message lists them and notes that RBAC grants narrow them further if the token belongs to a team. Previously every token the extension created silently took the server default, and there was no way to ask for a browse-only one.
- **First unit tests** (`npm test`, `node --test` over the compiled output): Arc's refusal classifier and the HTTP client's handling of 200/401/403/404 on the database and measurement listings.

## [0.3.6] - 2026-04-09

### Fixed
- **Webview Buttons Not Working**: Replaced all inline `onclick`/`oninput` handlers with CSP-safe `data-action` event delegation in notebook editor and query results views.
- **Measurements Not Displayed**: Fixed SHOW TABLES to use `FROM` clause instead of `x-arc-database` header (Arc ignores the header for SHOW commands). Added column-name-based response parsing for robustness.
- **Queries Failing with x-arc-database Header**: User-written queries (editor, alerts, notebooks) no longer send the `x-arc-database` header, since Arc rejects `database.table` syntax when the header is set. The header is only sent for extension-generated queries using short table names.
- **Show Measurements Command**: Now passes the active database to `getMeasurements()`.
- **Quoted Identifiers Removed**: Arc's SQL parser doesn't support standard SQL quoted identifiers, so `quoteIdentifier()` is no longer used in query generation.

## [0.3.0] - 2026-04-09

### Added
- **x-arc-database Header Support**: Queries now send the database context via the `x-arc-database` HTTP header instead of embedding `database.table` in SQL, improving query performance. Both forms remain supported.
- **Apache Arrow Query Format**: Full support for the `/api/v1/query/arrow` endpoint using the `apache-arrow` library. Configure via the `arc.resultFormat` setting (default: `json`). Arrow format is significantly faster for large result sets.
- **Active Database in Status Bar**: The status bar now shows the active database alongside the connection name.

### Fixed
- **SQL Injection in Generated Queries**: Table and database names in generated SQL (schema, preview, stats, etc.) are now properly quoted using `quoteIdentifier()` to prevent injection via specially-crafted measurement names.
- **Notebook Variable Injection**: Variable substitution in Arc Notebooks now escapes single quotes in string values, preventing SQL injection through notebook variables.
- **Completion Provider Performance**: Database/table completions are now cached for 30 seconds with request deduplication, eliminating redundant network requests on every keystroke.
- **Webview Content Security Policy**: All webviews (query results, notebooks) now include a strict CSP with nonce-based script authorization. Chart.js is bundled locally instead of loaded from a CDN, improving security and offline reliability.
- **Query Timeout Setting**: The `arc.queryTimeout` configuration setting is now actually read and applied (was previously hardcoded to 30s).
- **Double Health Check**: Removed duplicate `healthCheck()` call when connecting to a server.
- **Alert Condition Equality**: Alert `equals`/`not_equals` conditions now use strict string comparison instead of loose `==` which caused false positives (e.g., `0 == ""`).
- **Alert Timer Memory Leak**: Alert timer callbacks now self-cleanup if the alert was deleted while a check was in-flight. Minimum check interval of 10 seconds is enforced to prevent server overload.
- **TypeScript Deprecation**: Updated `moduleResolution` from deprecated `node` to `Node16` for TypeScript 7.0 compatibility.

### Changed
- Extracted shared `escapeHtml`, `quoteIdentifier`, and `escapeSqlString` utilities to reduce code duplication.
- Extracted `requireConnectedClient()` helper to replace ~15 duplicate connection-check patterns.
- Removed redundant error detail blocks that duplicated messages already produced by the error handler.

## [0.2.1] - 2025-11-28

### Fixed
- **Token Rotation Copy Bug**: Fixed issue where clicking "Copy Token" after rotating a token did not copy the new token to clipboard. The extension was looking for `response.token` but the Arc API returns the new token in `response.new_token`.

## [0.1.9] - 2024-10-21

### ⚠️ BREAKING CHANGES
- **API Endpoint Standardization**: All Arc API endpoints migrated to `/api/v1/...` pattern
- **Requires Arc v1.0.0+**: This version requires Arc Core v1.0.0 or later
- **Backwards Incompatible**: Will not work with pre-v1.0 Arc servers

### Changed
- Updated all API client calls to standardized `/api/v1/...` endpoints
- Query endpoints: `/query` → `/api/v1/query`
- Write endpoints: `/write/v1/msgpack` → `/api/v1/write/msgpack`
- Auth endpoints: `/auth/*` → `/api/v1/auth/*`
- Measurements: `/measurements` → `/api/v1/measurements`
- Metrics: `/metrics` → `/api/v1/metrics`
- Updated CSV import to use `/api/v1/write/msgpack`
- Updated data generator to use `/api/v1/write/msgpack`

### Migration
If upgrading from pre-v1.0 Arc server:
1. Upgrade Arc Core to v1.0.0 or later
2. Update extension to v0.1.9
3. Reconnect to Arc server
4. Existing saved connections and queries work automatically

## [0.1.8] - 2024-10-21

### Fixed
- Commands not registered - runtime dependencies now included in VSIX
- Extension activation with `onStartupFinished` event
- Activity bar icon format (PNG)

## [0.1.7] - 2024-10-21

### Fixed
- Data provider registration error
- Activity bar icon display

## [0.1.6] - 2024-10-21

### Improved
- Connection error handling with detailed messages
- Extension icon sizing (128x128)
- Logging for debugging

## [0.1.5] - 2024-10-21

### Improved
- Error handling infrastructure

## [0.1.4] - 2024-10-21

### Added
- **Parameterized Queries**: Variables section in notebooks for dynamic query substitution
- **CSV Import**: High-performance CSV import with MessagePack columnar format
- **Bulk Data Generator**: Generate realistic test data with 5 built-in presets
- **Alerting & Monitoring**: Create real-time alerts based on query results
- **Notebook Enhancements**: Run all cells, export to Markdown
- **Dark Mode Support**: Complete theme adaptation

### Improved
- Data ingestion performance: 25-35% faster
- Enhanced notebook UI and cell editing
- Chart visualization with auto-detection

### Fixed
- Schema queries for Arc compatibility
- Notebook cell editing and deletion
- Alert deletion error handling

## [0.1.3] - 2024-10-19

### Added
- Query History and Saved Queries
- Schema Explorer enhancements
- Export results (CSV, JSON, Markdown)
- Chart visualization
- SQL auto-completion
- Arc Notebooks support

## [0.1.2] - 2024-10-15

### Added
- Connection and token management
- Arc Explorer tree view
- Server token operations

## [0.1.1] - 2024-10-14

### Added
- Query execution
- Health check and metrics

## [0.1.0] - 2024-10-13

### Added
- Initial release
