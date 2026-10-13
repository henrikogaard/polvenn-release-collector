# Isolated prod01 rehearsal

Use `docker-compose.rehearsal.yml` with Coolify's Docker Compose build pack,
raw Compose enabled and connect_to_docker_network disabled. No domains,
published ports, auto-deploy or preview deploy. Keep the existing production
Dockerfile/Compose, sources, webhooks and deployment triggers unchanged.

The profile creates a new data volume owned by UID995/GID985 and a minimal
config with no sources and disabled webhook. Never import production data or
source configuration. The initializer runs with no network; the collector
runs only on its own Internal network. Startup collection and scheduler are
disabled, public status is disabled and external webhook env is empty.

Generate 32 random bytes encoded as64 lowercase hex characters for a new admin
test token. Save and byte-verify it in 1Password Personal as Document
`prod01 Beer Collector rehearsal token` before configuration. Set only the
runtime variable `REHEARSAL_ADMIN_TOKEN`, never a build argument or logged
value. The runtime command requires exactly64 lowercase hex characters,
including a raw length check before app import. Empty, whitespace-only,
padded, malformed or newline-terminated values are rejected. Empty Compose
build interpolation does not permit an unprotected runtime.

Acceptance checks:

- Native Coolify deployment finished, initializer exit0 and collector healthy.
- Only the new data volume, no bind mounts or public ports/router, runtime UID995.
- Collector's network is Internal=true, with blocked external TCP access.
- `/health`200 shows scheduler0, protected admin and disabled webhook.
- `/releases/latest`200 returns an empty feed; `/status`404.
- Anonymous/incorrect-token `/sources`, `/runs` and POST `/collect` give401.
- Read-only authenticated `/sources` and `/runs` show empty state.
- Config has no sources, SQLite release/run tables are empty, and startup
  collection is disabled. Never call an authenticated collection endpoint.
- Actual runtime token matches 1Password without logging either value.

This is not source scraping, real provider delivery, browser/admin UI QA,
historical restore or production cutover. The new empty test data is
rebuildable; no backup job is introduced. Record actual commits, deploys,
custody references and limits in the canonical VPS vault. Rollback after
approval is to stop only this candidate and retain its test volume/evidence.
Deletion and credential revocation require separate approval.
