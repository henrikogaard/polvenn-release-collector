import type { SourceStatus } from "../types/releases.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function formatValue(value: string | number | boolean | null): string {
  if (value == null) {
    return "n/a";
  }

  return String(value);
}

function renderStatusBadge(status: SourceStatus["lastStatus"], isDue: boolean): string {
  if (isDue) {
    return `<span class="badge due">due</span>`;
  }

  if (status === "success") {
    return `<span class="badge success">healthy</span>`;
  }

  if (status === "error") {
    return `<span class="badge error">error</span>`;
  }

  return `<span class="badge idle">idle</span>`;
}

function renderSourceCard(source: SourceStatus): string {
  return `
    <section class="card">
      <div class="card-header">
        <div>
          <h2>${escapeHtml(source.sourceName)}</h2>
          <p class="muted">${escapeHtml(source.sourceId)} · ${escapeHtml(source.sourceType)}</p>
        </div>
        ${renderStatusBadge(source.lastStatus, source.isDue)}
      </div>
      <dl>
        <div><dt>Enabled</dt><dd>${formatValue(source.enabled)}</dd></div>
        <div><dt>Interval</dt><dd>${formatValue(source.intervalMinutes ? `${source.intervalMinutes} min` : null)}</dd></div>
        <div><dt>Last run</dt><dd>${escapeHtml(formatValue(source.lastRunAt))}</dd></div>
        <div><dt>Last success</dt><dd>${escapeHtml(formatValue(source.lastSuccessAt))}</dd></div>
        <div><dt>Last error</dt><dd>${escapeHtml(formatValue(source.lastErrorAt))}</dd></div>
        <div><dt>Next due</dt><dd>${escapeHtml(formatValue(source.nextDueAt))}</dd></div>
        <div><dt>Duration</dt><dd>${escapeHtml(formatValue(source.lastRunDurationMs ? `${source.lastRunDurationMs} ms` : null))}</dd></div>
      </dl>
      ${source.lastErrorMessage ? `<p class="error-text">${escapeHtml(source.lastErrorMessage)}</p>` : ""}
    </section>
  `;
}

export function renderStatusPage(params: {
  serviceName: string;
  releaseFeedPath: string;
  healthPath: string;
  sources: SourceStatus[];
  adminProtected: boolean;
}): string {
  const { serviceName, releaseFeedPath, healthPath, sources, adminProtected } = params;
  const sourceCards = sources.map(renderSourceCard).join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(serviceName)} status</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f1e8;
        --panel: #fffdf8;
        --ink: #241f16;
        --muted: #6a6356;
        --line: #d8d1c4;
        --accent: #0b6e4f;
        --warn: #b36b00;
        --error: #9f1d1d;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif;
        background: linear-gradient(180deg, #f7f3ea 0%, #efe6d8 100%);
        color: var(--ink);
      }
      main {
        max-width: 960px;
        margin: 0 auto;
        padding: 48px 20px 64px;
      }
      h1, h2, p { margin-top: 0; }
      .hero {
        background: rgba(255, 253, 248, 0.86);
        border: 1px solid var(--line);
        border-radius: 24px;
        padding: 28px;
        box-shadow: 0 16px 40px rgba(36, 31, 22, 0.08);
      }
      .hero p {
        color: var(--muted);
        max-width: 60ch;
      }
      .links {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 18px;
      }
      .links a {
        color: var(--ink);
        text-decoration: none;
        background: #efe3ca;
        border: 1px solid #ddc9a6;
        border-radius: 999px;
        padding: 10px 14px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 18px;
        margin-top: 24px;
      }
      .card {
        background: rgba(255, 253, 248, 0.92);
        border: 1px solid var(--line);
        border-radius: 20px;
        padding: 20px;
      }
      .card-header {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: start;
      }
      .muted {
        color: var(--muted);
      }
      .badge {
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 0.85rem;
        white-space: nowrap;
      }
      .badge.success { background: #daf0e6; color: var(--accent); }
      .badge.error { background: #f8dede; color: var(--error); }
      .badge.due { background: #f7e7c9; color: var(--warn); }
      .badge.idle { background: #ece6da; color: var(--muted); }
      dl {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
        margin: 18px 0 0;
      }
      dl div {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        border-bottom: 1px dashed var(--line);
        padding-bottom: 8px;
      }
      dt {
        color: var(--muted);
      }
      dd {
        margin: 0;
        text-align: right;
      }
      .error-text {
        margin-top: 14px;
        color: var(--error);
      }
      @media (max-width: 640px) {
        .card-header, dl div {
          flex-direction: column;
        }
        dd {
          text-align: left;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <h1>${escapeHtml(serviceName)}</h1>
        <p>Public read-only status for the collector. Feed and health endpoints are linked below.${adminProtected ? " Administrative JSON endpoints are protected by bearer token." : ""}</p>
        <div class="links">
          <a href="${escapeHtml(releaseFeedPath)}">Latest releases</a>
          <a href="${escapeHtml(healthPath)}">Health JSON</a>
        </div>
      </section>
      <section class="grid">
        ${sourceCards || `<section class="card"><p class="muted">No sources configured.</p></section>`}
      </section>
    </main>
  </body>
</html>`;
}
