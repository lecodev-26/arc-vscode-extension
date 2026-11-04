# Arc Database Manager for VS Code

> Complete development toolkit for [Arc Database](https://github.com/basekick-labs/arc) - the high-performance time-series data warehouse.

[![Version](https://img.shields.io/badge/version-0.3.6-blue.svg)](https://marketplace.visualstudio.com/items?itemName=basekick-labs.arc-db-manager)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## Features

- **Connections** - multiple saved servers, tokens stored in the system keychain, health status in the sidebar and status bar.
- **Queries** - SQL IntelliSense for tables, columns and DuckDB functions. Run with `Ctrl+Enter` / `Cmd+Enter`. Results export to CSV, JSON or Markdown, and time-series results chart automatically.
- **Notebooks** - mix SQL and Markdown in `.arcnb` files, run cells individually or all at once, substitute variables into queries, export to Markdown with results.
- **Schema explorer** - browse databases and tables; right-click any table to preview data, show its schema or statistics, or generate a query.
- **Data ingestion** - CSV import with delimiter/header detection and batched writes, plus a generator for CPU, memory, network, IoT and custom test data. Both use MessagePack columnar format.
- **Alerts** - run a query on an interval and get a desktop notification when the result crosses a threshold. Five conditions, alert history, enable/disable without deleting.
- **Query management** - automatic history and saved queries, with execution time, row counts and errors.
- **Tokens** - create, rotate, verify and delete Arc server tokens from the sidebar. Creating one asks which permissions it should carry (Arc's default is read and write); `read` is what the extension needs to browse databases and run queries.
- **Themes** - adapts to Light, Dark and High Contrast automatically, charts included.
- **Database management** - list databases and their measurements through Arc's scoped database API, create databases from the Explorer, and delete them from a database's context menu after an explicit confirmation. Create/delete require an admin token; deletion must also be enabled by the Arc server.

See **[FEATURES.md](FEATURES.md)** for the full guide.

## Quick Start

1. Install **Arc Database Manager** from the VS Code marketplace.
2. Click **"Arc: Not Connected"** in the status bar and enter your host, port, protocol and token.
3. `Ctrl+Shift+P` → **Arc: New Query**, write SQL, and press `Ctrl+Enter` / `Cmd+Enter`.

Requires VS Code 1.85+, a reachable Arc instance, and an Arc authentication token with `read` permission.

Arc can restrict a token's reads to particular databases. The extension works with such a token, but it cannot enumerate databases with one — Arc refuses to list them all rather than returning a partial list, the same way `SHOW DATABASES` does. Set the database on the connection and the explorer, completions and queries all use that one; the explorer says so in place of the database list rather than failing silently.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `arc.defaultHost` | `localhost` | Default Arc server host |
| `arc.defaultPort` | `8000` | Default Arc server port |
| `arc.defaultProtocol` | `http` | Default protocol (`http` or `https`) |
| `arc.queryTimeout` | `30000` | Query timeout in milliseconds |
| `arc.maxResults` | `1000` | Maximum rows displayed in results |
| `arc.resultFormat` | `json` | Result format (`json` or `arrow`) |
| `arc.telemetry.enabled` | `true` | Send an anonymous daily install beacon (see [Telemetry](#telemetry)) |

## Commands

Everything is under `Arc:` in the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) - connecting, queries, notebooks, CSV import, test data, alerts and the schema explorer. `Ctrl+Enter` / `Cmd+Enter` executes the current query.

[Full command list](FEATURES.md)

## Examples

Time-series analysis with a moving average:

```sql
SELECT
  time,
  usage_user,
  AVG(usage_user) OVER (
    ORDER BY time
    ROWS BETWEEN 5 PRECEDING AND CURRENT ROW
  ) AS moving_avg
FROM telegraf.cpu
WHERE host = 'server01'
  AND time > now() - INTERVAL 24 HOUR
ORDER BY time DESC;
```

A parameterized notebook cell, where variables defined in the notebook are substituted before the query runs:

```sql
SELECT * FROM ${database}.${measurement}
WHERE time > now() - INTERVAL ${interval}
LIMIT 100;
```

An alert that fires when memory stays above 90%:

```
Query:     SELECT AVG(used_percent) FROM mem WHERE time > now() - INTERVAL 5 MINUTE
Condition: greater_than 90
Interval:  60s
```

## Performance

CSV import and the data generator sustain roughly 50k-200k rows/second using MessagePack columnar writes, with progress reporting on large files. Query results render up to `arc.maxResults` rows.

## Telemetry

The extension sends one anonymous beacon per day so we can count installs and see which versions are in use. It contains a randomly generated install ID, the extension and editor version, and the OS name and architecture - **never** queries, results, table names, server hostnames, or tokens. The install ID is generated locally and is not derived from your machine or account, so it cannot be tied to you or correlated across products.

Turn it off with `arc.telemetry.enabled`, or disable telemetry across VS Code with `telemetry.telemetryLevel: off` - either one is enough.

## Troubleshooting

**Cannot connect** - check Arc is up (`curl http://localhost:8000/health`), confirm host and port, then run **Arc: Verify Token**.

**Cannot create or delete a database** - both operations require an admin token. Database deletion is also disabled unless the Arc server has `delete.enabled=true`; the extension shows Arc's response when the server refuses an operation.

**"Token is scoped - set a database on this connection"** - the token can read, but Arc will not list every database for it. Edit the connection and set its database to one the token is granted. This is not a failure; it is what a database-scoped token looks like.

**"This token does not carry the read permission Arc requires"** - a different problem from the above, and naming a database will not fix it: create or use a token that includes `read`.

**Query timeout** - add a time filter (`WHERE time > now() - INTERVAL 1 HOUR`) and a `LIMIT`, or raise `arc.queryTimeout`.

**Import fails** - confirm the file is UTF-8 and the delimiter is right; try a small file first to isolate the problem.

[More troubleshooting](FEATURES.md#troubleshooting)

## Documentation

- **[FEATURES.md](FEATURES.md)** - complete feature guide
- **[CHANGELOG.md](CHANGELOG.md)** - release history
- **[DARK_MODE.md](DARK_MODE.md)** - theme details
- **[Arc Database](https://github.com/basekick-labs/arc)** - server documentation

## Support

- [Report an issue](https://github.com/basekick-labs/arc-vscode-extension/issues)
- [Arc repository](https://github.com/basekick-labs/arc)

## License

MIT - see [LICENSE](LICENSE).
