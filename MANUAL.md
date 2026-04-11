# Polvenn Release Collector Manual

This manual explains how the collector works in practice: what it does, how data flows through it, how the scheduler behaves, how the admin panel is meant to be used, and how it interacts with `mcp-polvenn`.

## What The Service Is

`polvenn-release-collector` is a standalone collector and feed service.

Its job is to:

- read source definitions from config
- fetch or import release data from those sources
- normalize the data into a common structure
- store it in SQLite
- expose the latest releases over HTTP
- provide an admin panel for operations, recovery and maintenance

It does not run as an MCP server itself.

The MCP server is a separate local process:

- `polvenn-release-collector` runs on your VPS
- `mcp-polvenn` runs locally in Codex, Claude Desktop or another MCP client

## Mental Model

Think of the system as two layers:

1. Collector layer
   Gathers and stores release data.
2. MCP layer
   Reads that stored data and combines it with Vinmonopolet lookups.

That split gives you:

- faster MCP responses
- less scraping pressure on external sites
- one central source of truth for external release data
- easier debugging when scraping breaks

## Main Components

### 1. Source config

The collector reads source definitions from:

- `polvenn-release-collector.config.json`

This file defines:

- which sources exist
- whether they are enabled
- how often they may run
- optional schedule windows
- top-level collector settings like webhook configuration

### 2. Source adapters

Each source type has an adapter that knows how to collect data.

Current source types:

- `file_json`
- `http_json`
- `rss_feed`
- `csv_import`
- `manual_import`
- `olbloggen_vinmonopolet`

All of them produce the same normalized release shape internally.

### 3. Collector service

The collector service decides:

- which enabled sources should run
- whether a source is due
- whether a source is inside its allowed schedule window
- how to record success, error or skip results

It also computes diff information for each run, so the admin panel can show what was actually new.

### 4. SQLite database

The database stores:

- releases
- release items
- latest source status
- source run history

This means the collector keeps both:

- current state
- operational history

### 5. HTTP server

The HTTP server exposes:

- public feed and health endpoints
- protected admin and maintenance endpoints

Typical split:

- public:
  - `/`
  - `/status`
  - `/health`
  - `/releases/latest`
- protected:
  - `/admin`
  - `/sources`
  - `/runs`
  - `/collect`
  - import/export/backup routes

### 6. Admin panel

The admin panel is meant for operations.

You use it to:

- view source health
- create and edit sources
- test a source
- force a run
- inspect run history
- configure webhooks
- export config, bundle or DB
- import and restore data
- create backup snapshots

## Data Flow

The normal data flow looks like this:

1. Scheduler wakes up or a manual run is triggered.
2. The collector checks enabled sources.
3. For each source, it decides whether the source is due.
4. If due, the relevant adapter fetches or imports source data.
5. The collector normalizes the results.
6. The collector compares them to what is already in SQLite.
7. It stores releases and items.
8. It stores source status and run history.
9. It optionally sends webhook notifications.
10. `mcp-polvenn` reads the latest releases from `/releases/latest`.

## Release Model

Every source is normalized into the same structure:

- `id`
- `title`
- `source`
- `publishedAt`
- `url`
- `items[]`

Each item typically contains:

- `articleNumber`
- `producer`
- `name`
- `style`
- `abv`
- `country`
- `releaseDate`

That is why the MCP can treat all external sources in a consistent way even if they come from HTML scraping, CSV or RSS.

## Scheduling And Due Logic

The collector has two scheduling layers.

### Global scheduler tick

Set by:

- `POLVENN_COLLECTOR_INTERVAL_MINUTES`

This controls how often the service wakes up and checks sources.

It does not force every source to run.

### Per-source due logic

Each source may define:

- `intervalMinutes`
- `scheduleWindow`

The source is only collected when:

- it is enabled
- its interval allows it
- it is inside its schedule window

Supported windows:

- `always`
- `monthly_window`
- `date_range`

Typical example:

- scheduler wakes hourly
- Ølbloggen source only runs every 43200 minutes
- and only during day 25 to day 5 of the month window

That keeps the service polite and efficient.

## Source Status

For each source, the collector tracks operational state such as:

- last run time
- last success time
- last error time
- last error message
- last run duration
- next due time
- whether the source is currently due

This is what powers:

- `/sources`
- the admin health overview

## Run History And Diffs

Each run records:

- trigger type
- status
- duration
- release count
- new release count
- new release titles
- structured diff data

The diff data is especially useful in admin because it shows what actually changed, not just that a source ran.

## Webhooks

The collector can send webhooks after runs.

Supported formats:

- `generic`
- `slack`
- `discord`

Webhooks are intended for:

- new release notifications
- error alerts

The runtime webhook source is:

1. environment override, if set
2. otherwise JSON config settings

## Feed API

The endpoint Polvenn MCP actually depends on is:

- `/releases/latest?limit=N`

This returns the latest normalized releases as JSON.

The collector is designed so this endpoint stays simple, stable and fast.

## Admin Import / Restore Model

The collector supports three restore families:

- config import
- bundle restore
- raw database restore

### Config import

Replaces:

- settings
- source definitions

Does not replace:

- stored releases
- source snapshots
- run history

### Bundle restore

Can replace:

- settings
- source definitions
- releases
- source run snapshots
- run history

This is the best format for migrating or restoring a full collector state.

### Raw DB restore

Uses an uploaded SQLite file.

It can either:

- replace the entire DB file
- or selectively restore parts of the uploaded DB into the current DB

Current config file remains unchanged unless you separately import config.

## Preview Before Restore

Every restore goes through a preview step.

The preview shows:

- what is in the import
- what changes compared to current state
- default restore selections

For example:

- sources added, removed or updated
- webhook settings changing
- release count going from current to imported state
- run history count changes

This makes restore much safer than a blind import.

## Selective Restore

At apply time, you can choose which parts to restore.

Selectable parts:

- settings
- source definitions
- releases
- source run snapshots
- run history

Examples:

- restore only source definitions
- restore only releases from a bundle
- restore a DB file but keep current run history
- restore settings and sources without touching stored release data

## Backups

Before restore actions, the collector creates a backup snapshot.

A backup snapshot includes:

- current config file
- current SQLite database
- a manifest file

This gives you a rollback point before high-impact operations.

## Service Lifecycle On The VPS

Typical production runtime:

1. `systemd` starts the collector.
2. The collector binds to `127.0.0.1:4100`.
3. Caddy or Nginx exposes it on `https://beer.ogard.cloud`.
4. Scheduler runs in-process.
5. Admin operations happen through the web UI.
6. MCP clients consume the public feed.

The collector is stateful because it owns:

- config file
- SQLite DB
- backup snapshots

That means `/var/lib/polvenn-release-collector` is operationally important and should be backed up.

## How It Connects To Polvenn MCP

The MCP server should be configured with:

- `releaseFeedUrl = https://beer.ogard.cloud`

Then the local MCP process reads:

- `https://beer.ogard.cloud/releases/latest?limit=...`

So in practice:

- collector is central and remote
- MCP remains local and personal

## Typical Operational Tasks

### Add a new source

1. Open `/admin`
2. Add the source
3. Test the source
4. Save it
5. Run it manually
6. Confirm data appears in `/releases/latest`

### Troubleshoot a broken source

1. Open `/admin`
2. Check source status and last error
3. Run a test
4. Inspect run history
5. Adjust source config

### Restore from backup/export

1. Open `/admin`
2. Import config, bundle or DB
3. Review preview
4. Choose restore parts
5. Apply restore
6. Validate feed and source health

### Deploy an update

1. Pull new code on the VPS
2. Run `npm install`
3. Run `npm run build`
4. Restart `systemd`
5. Verify `/health`
6. Verify `/releases/latest`

## Recommended Validation Routine

After config changes or deploys, verify:

```bash
curl https://beer.ogard.cloud/health
curl https://beer.ogard.cloud/releases/latest?limit=3
curl -H "Authorization: Bearer <token>" https://beer.ogard.cloud/sources
curl -H "Authorization: Bearer <token>" https://beer.ogard.cloud/runs?limit=5
```

From the MCP side, also verify:

```text
Validate my Polvenn configuration and tell me which integrations are working.
```

## Where To Look Next

For deployment:

- [DEPLOY.md](/Users/henrik/Repos/polvenn-release-collector/deploy/DEPLOY.md)

For day-to-day setup:

- [README.md](/Users/henrik/Repos/polvenn-release-collector/README.md)

For MCP usage:

- [mcp-polvenn README](/Users/henrik/Repos/mcp-polvenn/README.md)
