# Polvenn Release Collector

`polvenn-release-collector` is the external release-feed service for Polvenn.

It does three things:

1. collects release data from configured sources
2. stores normalized releases, source status, and run history in SQLite
3. exposes a small HTTP API that `mcp-polvenn` can read from

This keeps scraping and imports out of the MCP runtime, which makes Polvenn faster, simpler, and kinder to external sites.

## How It Fits Together

- `polvenn-release-collector`
  scrape, import, normalize, store, expose releases
- `mcp-polvenn`
  read `releaseFeedUrl` from the collector and combine it with Vinmonopolet lookups

In practice:

- the collector runs as a normal web service
- `mcp-polvenn` still runs locally as a stdio MCP server
- the MCP never scrapes directly

## What This Repo Includes

- multiple source types:
  - `file_json`
  - `http_json`
  - `rss_feed`
  - `csv_import`
  - `manual_import`
  - `olbloggen_vinmonopolet`
- per-source intervals and schedule windows
- admin panel
- run history
- webhook alerts
- export, backup, import, and restore
- feed endpoint at `GET /releases/latest`

If you want the deeper service manual, see [MANUAL.md](./MANUAL.md).
If you want the production deployment guide, see [deploy/DEPLOY.md](./deploy/DEPLOY.md).

## Quick Start

### 1. Install

```bash
npm install
npm run build
```

### 2. Create config

```bash
cp polvenn-release-collector.config.example.json polvenn-release-collector.config.json
```

Start with a minimal config:

```json
{
  "settings": {
    "webhook": {
      "enabled": false,
      "url": "env:POLVENN_COLLECTOR_WEBHOOK_URL",
      "format": "generic"
    }
  },
  "sources": []
}
```

### 3. Set environment

Example local env:

```bash
export POLVENN_COLLECTOR_PORT=4100
export POLVENN_COLLECTOR_INTERVAL_MINUTES=60
export POLVENN_COLLECTOR_RUN_ON_START=true
export POLVENN_COLLECTOR_PUBLIC_STATUS_PAGE=true
export POLVENN_COLLECTOR_ADMIN_TOKEN='replace-with-a-long-random-token'
```

You can also copy values from [.env.example](./.env.example).

### 4. Start the collector

```bash
npm start
```

By default it listens on `http://127.0.0.1:4100`.

### 5. Verify that it works

Health:

```bash
curl http://127.0.0.1:4100/health
```

Feed:

```bash
curl http://127.0.0.1:4100/releases/latest?limit=3
```

Admin:

```text
http://127.0.0.1:4100/admin
```

## Configure Sources

Sources are stored in `polvenn-release-collector.config.json`.

Each source can define:

- `id`
- `name`
- `type`
- `enabled`
- `intervalMinutes`
- optional `scheduleWindow`
- source-specific fields like `url`, `listingUrl`, `filePath`, or manual items

Example monthly Ølbloggen source:

```json
{
  "id": "olbloggen-monthly",
  "name": "Ølbloggen monthly Vinmonopolet releases",
  "type": "olbloggen_vinmonopolet",
  "enabled": true,
  "intervalMinutes": 43200,
  "scheduleWindow": {
    "mode": "monthly_window",
    "startDay": 25,
    "endDay": 5
  },
  "listingUrl": "https://www.olbloggen.no/category/vinmonopolet-nyheter/",
  "maxPages": 1,
  "maxArticles": 6
}
```

Supported schedule windows:

- `always`
- `monthly_window`
- `date_range`

## Useful Endpoints

Public endpoints:

- `GET /`
- `GET /status`
- `GET /health`
- `GET /releases/latest?limit=3`

Protected endpoints:

- `GET /admin`
- `GET /sources`
- `GET /runs`
- `POST /collect`
- `POST /collect?source=source-id`
- `POST /admin/run`
- `POST /admin/sources/save`
- `POST /admin/sources/test`
- `POST /admin/sources/delete`
- `POST /admin/settings/save`
- `GET /admin/export/config`
- `GET /admin/export/bundle`
- `GET /admin/export/database`
- `POST /admin/import/preview`
- `POST /admin/import/apply`
- `POST /admin/import/cancel`
- `POST /admin/import/config`
- `POST /admin/import/bundle`
- `POST /admin/backups/create`

Examples:

Manual collect:

```bash
curl -X POST -H 'Authorization: Bearer <token>' http://127.0.0.1:4100/collect
```

Manual collect that still respects due rules:

```bash
curl -X POST -H 'Authorization: Bearer <token>' 'http://127.0.0.1:4100/collect?respectIntervals=true'
```

Source status:

```bash
curl -H 'Authorization: Bearer <token>' http://127.0.0.1:4100/sources
```

Run history:

```bash
curl -H 'Authorization: Bearer <token>' 'http://127.0.0.1:4100/runs?limit=20'
```

## Admin Panel

The admin panel supports:

- source health overview
- create, edit, test, delete, and run sources
- per-source interval and schedule-window editing
- webhook setup
- run history
- diff view for recent runs
- config export and bundle export
- raw DB download
- config import and full restore
- preview and selective restore before apply
- raw `.db` restore
- server-side backup snapshots

Open:

```text
http://127.0.0.1:4100/admin
```

If `POLVENN_COLLECTOR_ADMIN_TOKEN` is set, you log in with that token.

## Connect It To Polvenn

Once the collector is running, point `mcp-polvenn` at it with `releaseFeedUrl`.

### Local collector

If both run on the same machine:

```text
Configure polvenn with release feed URL http://127.0.0.1:4100.
```

### Hosted collector

If the collector is deployed on a VPS:

```text
Configure polvenn with release feed URL https://beer.ogard.cloud.
```

That means Polvenn will read from:

```text
https://beer.ogard.cloud/releases/latest?limit=...
```

Recommended order:

1. Deploy the collector.
2. Verify `/health`.
3. Verify `/releases/latest?limit=3`.
4. Start `mcp-polvenn` locally.
5. Configure `releaseFeedUrl`.
6. Validate Polvenn configuration from the MCP client.

## VPS Setup

The intended production model is:

- collector listens on `127.0.0.1:4100`
- Caddy or Nginx exposes it on `https://beer.ogard.cloud`
- admin token protects mutating endpoints
- `mcp-polvenn` uses the public feed URL

See the full guide here:

- [deploy/DEPLOY.md](./deploy/DEPLOY.md)
- [deploy/systemd/polvenn-release-collector.service](./deploy/systemd/polvenn-release-collector.service)
- [deploy/caddy/Caddyfile](./deploy/caddy/Caddyfile)
- [deploy/nginx/polvenn-release-collector.conf](./deploy/nginx/polvenn-release-collector.conf)

## Feed Shape

`GET /releases/latest` returns:

```json
{
  "releases": [
    {
      "id": "2026-04-01-main",
      "title": "April 2026 main release",
      "source": "monthly-release",
      "publishedAt": "2026-04-01T08:00:00Z",
      "url": "https://example.com/releases/2026-04-01-main",
      "items": [
        {
          "country": "Norge",
          "articleNumber": "20162402",
          "producer": "Amundsen Bryggeri",
          "name": "Example Beer",
          "style": "Imperial Stout",
          "abv": 12,
          "releaseDate": "2026-04-01"
        }
      ]
    }
  ]
}
```

This is the format `mcp-polvenn` expects from `releaseFeedUrl`.

## Environment Variables

- `POLVENN_COLLECTOR_PORT`
  Default: `4100`
- `POLVENN_COLLECTOR_DATA_DIR`
  Default: `~/.polvenn-release-collector`
- `POLVENN_COLLECTOR_DB_PATH`
  Default: `<data-dir>/collector.db`
- `POLVENN_COLLECTOR_SOURCES_PATH`
  Default: `<cwd>/polvenn-release-collector.config.json`
- `POLVENN_COLLECTOR_RUN_ON_START`
  Default: `true`
- `POLVENN_COLLECTOR_INTERVAL_MINUTES`
  Default: `0`
  This is the scheduler tick. Each source still decides if it is actually due.
- `POLVENN_COLLECTOR_ADMIN_TOKEN`
  Optional admin token for protected endpoints and admin login
- `POLVENN_COLLECTOR_PUBLIC_STATUS_PAGE`
  Default: `true`
- `POLVENN_COLLECTOR_SECURE_COOKIES`
  Default: `false`
  Set to `true` behind HTTPS
- `POLVENN_COLLECTOR_WEBHOOK_URL`
  Optional env override for webhook destination
- `POLVENN_COLLECTOR_WEBHOOK_FORMAT`
  Default: `generic`
  Supported: `generic`, `slack`, `discord`

If `POLVENN_COLLECTOR_WEBHOOK_URL` is set, it overrides webhook settings from the JSON config.

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
