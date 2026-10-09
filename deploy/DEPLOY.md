# Deploying Polvenn Release Collector To A VPS

This is a practical guide for running the collector on your own Linux VPS and exposing it on:

- `https://beer.ogard.cloud/`

The goal is:

- public feed for Polvenn MCP
- protected admin panel and admin endpoints
- automatic startup via `systemd`
- HTTPS via Caddy or Nginx

## Overview

You will end up with:

- app code in `/opt/polvenn-release-collector`
- persistent data in `/var/lib/polvenn-release-collector`
- environment file in `/etc/polvenn-release-collector.env`
- collector listening on `127.0.0.1:4100`
- reverse proxy exposing `https://beer.ogard.cloud`

## Coolify / Docker Deployment

For a Coolify Application backed by this Git repository, select the Dockerfile
build pack. The repository Dockerfile builds the TypeScript app, keeps only
production dependencies in the runtime image, and runs the process as UID/GID
`995:985` to match the existing `polvenn` service account and persisted data.

Configure the application to:

- expose internal port `4100` without publishing a host port directly
- mount persistent storage at `/var/lib/polvenn-release-collector`
- set `POLVENN_COLLECTOR_HOST=0.0.0.0` so Coolify's proxy can reach the container
- set `POLVENN_COLLECTOR_DATA_DIR` and `POLVENN_COLLECTOR_DB_PATH` inside that
  mount
- keep secrets in Coolify environment variables, not in the repository or image

When migrating an existing instance, preserve the data directory's ownership
and modes; the runtime UID/GID must be able to read the config and read/write
the database files. Keep startup collection and periodic scraping disabled on a
staged copy until the production cutover, otherwise both old and new instances
may collect concurrently.

Do not configure a production domain or change DNS until the migrated data,
health checks, and cutover plan have been verified.

## 1. Prerequisites On The VPS

You need:

- a Linux VPS with `sudo`
- DNS for `beer.ogard.cloud` pointing to the server
- Node.js 18 or newer
- either Caddy or Nginx installed

Quick checks:

```bash
node -v
npm -v
```

If Node is missing, install Node 20 LTS or newer before continuing.

## 2. Create A Dedicated Service User

```bash
sudo useradd --system --create-home --home-dir /var/lib/polvenn-release-collector --shell /usr/sbin/nologin polvenn
sudo mkdir -p /opt/polvenn-release-collector /var/lib/polvenn-release-collector
sudo chown -R polvenn:polvenn /opt/polvenn-release-collector /var/lib/polvenn-release-collector
```

## 3. Upload Or Clone The App

If you clone from Git:

```bash
sudo -u polvenn git clone https://github.com/henrikogaard/polvenn-release-collector.git /opt/polvenn-release-collector
```

Or copy the repo manually to `/opt/polvenn-release-collector`.

Then install and build:

```bash
cd /opt/polvenn-release-collector
sudo -u polvenn npm install
sudo -u polvenn npm run build
sudo -u polvenn cp polvenn-release-collector.config.example.json polvenn-release-collector.config.json
```

## 4. Configure The Collector

Edit:

- `/opt/polvenn-release-collector/polvenn-release-collector.config.json`

Recommended first source:

```json
{
  "settings": {
    "webhook": {
      "enabled": false,
      "url": "env:POLVENN_COLLECTOR_WEBHOOK_URL",
      "format": "generic"
    }
  },
  "sources": [
    {
      "id": "monthly-article-source",
      "name": "Monthly article release source",
      "type": "rss_feed",
      "enabled": true,
      "intervalMinutes": 43200,
      "scheduleWindow": {
        "mode": "monthly_window",
        "startDay": 25,
        "endDay": 5
      },
      "url": "https://example.com/feed.xml",
      "maxItems": 20
    }
  ]
}
```

## 5. Create The Environment File

Create:

- `/etc/polvenn-release-collector.env`

Example:

```bash
POLVENN_COLLECTOR_PORT=4100
POLVENN_COLLECTOR_HOST=127.0.0.1
POLVENN_COLLECTOR_INTERVAL_MINUTES=60
POLVENN_COLLECTOR_RUN_ON_START=true
POLVENN_COLLECTOR_PUBLIC_STATUS_PAGE=true
POLVENN_COLLECTOR_SECURE_COOKIES=true
POLVENN_COLLECTOR_ADMIN_TOKEN=replace-with-a-long-random-token
POLVENN_COLLECTOR_DATA_DIR=/var/lib/polvenn-release-collector
POLVENN_COLLECTOR_DB_PATH=/var/lib/polvenn-release-collector/collector.db
POLVENN_COLLECTOR_SOURCES_PATH=/opt/polvenn-release-collector/polvenn-release-collector.config.json
POLVENN_COLLECTOR_WEBHOOK_URL=
POLVENN_COLLECTOR_WEBHOOK_FORMAT=generic
```

Recommended:

- use a long random admin token
- keep the app bound behind the reverse proxy
- keep `POLVENN_COLLECTOR_HOST=127.0.0.1`; do not expose port 4100 directly
- only expose the feed publicly

Generate a token:

```bash
openssl rand -hex 32
```

Protect the file:

```bash
sudo chown root:polvenn /etc/polvenn-release-collector.env
sudo chmod 640 /etc/polvenn-release-collector.env
```

## 6. Install The systemd Service

```bash
sudo cp /opt/polvenn-release-collector/deploy/systemd/polvenn-release-collector.service /etc/systemd/system/polvenn-release-collector.service
sudo systemctl daemon-reload
sudo systemctl enable polvenn-release-collector
sudo systemctl start polvenn-release-collector
sudo systemctl status polvenn-release-collector
```

Useful logs:

```bash
journalctl -u polvenn-release-collector -f
```

## 7. Put It Behind HTTPS

The collector should stay on `127.0.0.1:4100`. Expose it through Caddy or Nginx.

### Option A: Caddy

```bash
sudo cp /opt/polvenn-release-collector/deploy/caddy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Then verify:

```bash
sudo systemctl status caddy
```

### Option B: Nginx

```bash
sudo cp /opt/polvenn-release-collector/deploy/nginx/polvenn-release-collector.conf /etc/nginx/sites-available/polvenn-release-collector.conf
sudo ln -sf /etc/nginx/sites-available/polvenn-release-collector.conf /etc/nginx/sites-enabled/polvenn-release-collector.conf
sudo nginx -t
sudo systemctl reload nginx
```

If you use Nginx, make sure TLS is configured separately, for example with Let's Encrypt.

## 8. Verify The Deployment

Public endpoints:

```bash
curl https://beer.ogard.cloud/health
curl https://beer.ogard.cloud/releases/latest?limit=3
curl https://beer.ogard.cloud/
```

Protected endpoints:

```bash
curl -H "Authorization: Bearer <token>" https://beer.ogard.cloud/sources
curl -H "Authorization: Bearer <token>" https://beer.ogard.cloud/runs?limit=5
curl -X POST -H "Authorization: Bearer <token>" "https://beer.ogard.cloud/collect?respectIntervals=true"
```

Browser admin:

```text
https://beer.ogard.cloud/admin
```

## 9. Updating The Deployment Later

When you ship a new version:

```bash
cd /opt/polvenn-release-collector
sudo -u polvenn git pull
sudo -u polvenn npm install
sudo -u polvenn npm run build
sudo systemctl restart polvenn-release-collector
sudo systemctl status polvenn-release-collector
```

If you changed deploy files:

```bash
sudo cp /opt/polvenn-release-collector/deploy/systemd/polvenn-release-collector.service /etc/systemd/system/polvenn-release-collector.service
sudo systemctl daemon-reload
sudo systemctl restart polvenn-release-collector
```

## 10. Point Polvenn MCP At The Hosted Collector

In your MCP client, Polvenn itself still runs locally over stdio. Only the release feed becomes remote.

Configure Polvenn with:

```text
releaseFeedUrl = https://beer.ogard.cloud
```

The MCP will then read:

```text
https://beer.ogard.cloud/releases/latest?limit=...
```

You can set this from an MCP client with a prompt like:

```text
Configure polvenn with release feed URL https://beer.ogard.cloud.
```

Then validate:

```text
Validate my Polvenn configuration and tell me which integrations are working.
```

## 11. Recommended Production Checklist

- `beer.ogard.cloud` resolves to the VPS
- `https://beer.ogard.cloud/health` returns `ok: true`
- `https://beer.ogard.cloud/releases/latest?limit=3` returns JSON
- `/admin` requires your token
- `POLVENN_COLLECTOR_SECURE_COOKIES=true`
- backups are being created before imports/restores
- collector logs are clean in `journalctl`
