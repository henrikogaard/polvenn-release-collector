import { serializeSourceConfigForForm } from "../sources/index.js";
import type { ImportPreviewSummary } from "../types/admin.js";
import type {
  SourceRunHistoryEntry,
  SourceRunResult,
  SourceStatus,
} from "../types/releases.js";
import type { CollectorSettings, SourceConfig } from "../types/source.js";

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

function renderMessage(message: string | null, tone: "success" | "error" | "info" = "info"): string {
  if (!message) {
    return "";
  }

  return `<p class="message ${tone}">${escapeHtml(message)}</p>`;
}

function renderStatusBadge(status: SourceStatus | undefined): string {
  if (status?.isDue) {
    return `<span class="badge due">due</span>`;
  }

  if (status?.lastStatus === "success") {
    return `<span class="badge success">healthy</span>`;
  }

  if (status?.lastStatus === "error") {
    return `<span class="badge error">error</span>`;
  }

  return `<span class="badge idle">idle</span>`;
}

function summarizeRunResult(result: SourceRunResult): string {
  if (result.status === "success") {
    return `${result.sourceName} collected ${result.releasesCollected} release(s), ${result.newReleaseCount} new.`;
  }

  if (result.status === "skipped") {
    return `${result.sourceName} skipped. ${result.reason ?? "Not due yet."}`;
  }

  return `${result.sourceName} failed. ${result.reason ?? "Unknown error."}`;
}

function summarizeHistoryEntry(entry: SourceRunHistoryEntry): string {
  const prefix = `${entry.sourceName} [${entry.trigger}]`;
  if (entry.status === "success") {
    return `${prefix}: collected ${entry.releasesCollected} release(s), ${entry.newReleaseCount} new.`;
  }

  if (entry.status === "skipped") {
    return `${prefix}: skipped. ${entry.errorMessage ?? "Not due yet."}`;
  }

  return `${prefix}: failed. ${entry.errorMessage ?? "Unknown error."}`;
}

function renderField(params: {
  label: string;
  name: string;
  value?: string | number;
  placeholder?: string;
  type?: "text" | "number" | "url" | "date";
  required?: boolean;
}): string {
  const {
    label,
    name,
    value = "",
    placeholder = "",
    type = "text",
    required = false,
  } = params;

  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <input
        type="${type}"
        name="${escapeHtml(name)}"
        value="${escapeHtml(String(value))}"
        placeholder="${escapeHtml(placeholder)}"
        ${required ? "required" : ""}
      />
    </label>
  `;
}

function renderTextArea(params: {
  label: string;
  name: string;
  value?: string;
  placeholder?: string;
  rows?: number;
  required?: boolean;
}): string {
  const {
    label,
    name,
    value = "",
    placeholder = "",
    rows = 10,
    required = false,
  } = params;

  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <textarea
        name="${escapeHtml(name)}"
        rows="${rows}"
        placeholder="${escapeHtml(placeholder)}"
        ${required ? "required" : ""}
      >${escapeHtml(value)}</textarea>
    </label>
  `;
}

function renderFileInput(params: {
  label: string;
  accept?: string;
  targetField: string;
  mode: "text" | "data-url";
}): string {
  const { label, accept = "", targetField, mode } = params;
  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <input
        type="file"
        accept="${escapeHtml(accept)}"
        data-file-target="${escapeHtml(targetField)}"
        data-file-mode="${escapeHtml(mode)}"
      />
    </label>
  `;
}

function renderSelect(params: {
  label: string;
  name: string;
  value: string;
  options: Array<{ value: string; label: string }>;
}): string {
  const { label, name, value, options } = params;

  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <select name="${escapeHtml(name)}">
        ${options.map((option) => `
          <option value="${escapeHtml(option.value)}" ${option.value === value ? "selected" : ""}>
            ${escapeHtml(option.label)}
          </option>
        `).join("")}
      </select>
    </label>
  `;
}

function getSchedulePreset(intervalMinutes: number | undefined): string {
  switch (intervalMinutes) {
    case 60:
      return "hourly";
    case 360:
      return "every_6_hours";
    case 1440:
      return "daily";
    case 10080:
      return "weekly";
    case 43200:
      return "monthly";
    default:
      return "custom";
  }
}

function renderScheduleEditor(params: {
  intervalMinutes: number | undefined;
  scheduleWindowMode?: string;
  scheduleStartDay?: string;
  scheduleEndDay?: string;
  scheduleStartDate?: string;
  scheduleEndDate?: string;
}): string {
  const {
    intervalMinutes,
    scheduleWindowMode = "always",
    scheduleStartDay = "",
    scheduleEndDay = "",
    scheduleStartDate = "",
    scheduleEndDate = "",
  } = params;
  const preset = getSchedulePreset(intervalMinutes);

  return `
    <div class="subgrid">
      ${renderSelect({
        label: "Interval",
        name: "schedulePreset",
        value: preset,
        options: [
          { value: "custom", label: "Custom" },
          { value: "hourly", label: "Hourly" },
          { value: "every_6_hours", label: "Every 6 hours" },
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly" },
          { value: "monthly", label: "Monthly" },
        ],
      })}
      ${renderField({
        label: "Custom interval minutes",
        name: "intervalMinutes",
        value: intervalMinutes ?? "",
        type: "number",
        placeholder: "60",
      })}
      ${renderSelect({
        label: "Window",
        name: "scheduleWindowMode",
        value: scheduleWindowMode,
        options: [
          { value: "always", label: "Any time" },
          { value: "monthly_window", label: "Monthly day window" },
          { value: "date_range", label: "Fixed date range" },
        ],
      })}
      ${renderField({
        label: "Window start day",
        name: "scheduleStartDay",
        value: scheduleStartDay,
        type: "number",
        placeholder: "25",
      })}
      ${renderField({
        label: "Window end day",
        name: "scheduleEndDay",
        value: scheduleEndDay,
        type: "number",
        placeholder: "5",
      })}
      ${renderField({
        label: "Window start date",
        name: "scheduleStartDate",
        value: scheduleStartDate,
        type: "date",
      })}
      ${renderField({
        label: "Window end date",
        name: "scheduleEndDate",
        value: scheduleEndDate,
        type: "date",
      })}
    </div>
  `;
}

function renderDiffList(entries: Array<{ title: string; itemCount: number; itemNames: string[]; url: string | null }>): string {
  if (entries.length === 0) {
    return `<p class="muted">No new releases in this run.</p>`;
  }

  return `
    <ul class="diff-list">
      ${entries.map((entry) => `
        <li>
          <strong>${escapeHtml(entry.title)}</strong>
          <span class="muted">${escapeHtml(String(entry.itemCount))} item(s)</span>
          ${entry.url ? `<a href="${escapeHtml(entry.url)}" target="_blank" rel="noreferrer">open</a>` : ""}
          ${entry.itemNames.length > 0
            ? `<div class="chips">${entry.itemNames.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}</div>`
            : ""}
        </li>
      `).join("")}
    </ul>
  `;
}

function renderSourceSpecificFields(config: SourceConfig): string {
  const values = serializeSourceConfigForForm(config);

  switch (config.type) {
    case "file_json":
      return renderField({
        label: "Path",
        name: "path",
        value: values.path,
        placeholder: "./example-releases.json",
        required: true,
      });
    case "http_json":
      return renderField({
        label: "URL",
        name: "url",
        value: values.url,
        placeholder: "https://example.com/releases.json",
        type: "url",
        required: true,
      });
    case "rss_feed":
      return [
        renderField({
          label: "Feed URL",
          name: "url",
          value: values.url,
          placeholder: "https://example.com/feed.xml",
          type: "url",
          required: true,
        }),
        renderField({
          label: "Max items",
          name: "maxItems",
          value: values.maxItems,
          type: "number",
        }),
      ].join("");
    case "csv_import":
      return [
        renderField({ label: "Path", name: "path", value: values.path, placeholder: "./releases.csv" }),
        renderField({ label: "URL", name: "url", value: values.url, type: "url", placeholder: "https://example.com/releases.csv" }),
        renderField({ label: "Delimiter", name: "delimiter", value: values.delimiter, placeholder: "," }),
        renderField({ label: "Release ID", name: "releaseId", value: values.releaseId, required: true }),
        renderField({ label: "Release title", name: "releaseTitle", value: values.releaseTitle, required: true }),
        renderField({ label: "Published at", name: "publishedAt", value: values.publishedAt, placeholder: "2026-04-01T00:00:00Z", required: true }),
        renderField({ label: "Article number column", name: "articleNumberColumn", value: values.articleNumberColumn }),
        renderField({ label: "Producer column", name: "producerColumn", value: values.producerColumn }),
        renderField({ label: "Name column", name: "nameColumn", value: values.nameColumn }),
        renderField({ label: "Style column", name: "styleColumn", value: values.styleColumn }),
        renderField({ label: "ABV column", name: "abvColumn", value: values.abvColumn }),
        renderField({ label: "Country column", name: "countryColumn", value: values.countryColumn }),
        renderField({ label: "Release date column", name: "releaseDateColumn", value: values.releaseDateColumn }),
      ].join("");
    case "manual_import":
      return renderTextArea({
        label: "Release JSON",
        name: "manualPayload",
        value: values.manualPayload,
        placeholder: "{\n  \"releases\": []\n}",
        rows: 16,
        required: true,
      });
    case "olbloggen_vinmonopolet":
      return [
        renderField({
          label: "Listing URL",
          name: "listingUrl",
          value: values.listingUrl,
          type: "url",
          placeholder: "https://www.olbloggen.no/category/vinmonopolet-nyheter/",
          required: true,
        }),
        renderField({
          label: "Max pages",
          name: "maxPages",
          value: values.maxPages,
          type: "number",
        }),
        renderField({
          label: "Max articles",
          name: "maxArticles",
          value: values.maxArticles,
          type: "number",
        }),
        renderField({
          label: "Title prefix",
          name: "titlePrefix",
          value: values.titlePrefix,
        }),
      ].join("");
  }
}

function renderSourceEditorCard(config: SourceConfig, status: SourceStatus | undefined): string {
  const values = serializeSourceConfigForForm(config);

  return `
    <section class="card">
      <div class="card-header">
        <div>
          <h2>${escapeHtml(config.name)}</h2>
          <p class="muted">${escapeHtml(config.id)} · ${escapeHtml(config.type)}</p>
        </div>
        ${renderStatusBadge(status)}
      </div>
      <dl>
        <div><dt>Enabled</dt><dd>${formatValue(config.enabled !== false)}</dd></div>
        <div><dt>Interval</dt><dd>${escapeHtml(formatValue(status?.intervalMinutes ? `${status.intervalMinutes} min` : null))}</dd></div>
        <div><dt>Window</dt><dd>${escapeHtml(status?.scheduleSummary ?? "Any time")}</dd></div>
        <div><dt>Last run</dt><dd>${escapeHtml(formatValue(status?.lastRunAt ?? null))}</dd></div>
        <div><dt>Last success</dt><dd>${escapeHtml(formatValue(status?.lastSuccessAt ?? null))}</dd></div>
        <div><dt>Last error</dt><dd>${escapeHtml(formatValue(status?.lastErrorAt ?? null))}</dd></div>
        <div><dt>Next due</dt><dd>${escapeHtml(formatValue(status?.nextDueAt ?? null))}</dd></div>
      </dl>
      ${status?.lastErrorMessage ? `<p class="error-text">${escapeHtml(status.lastErrorMessage)}</p>` : ""}
      <div class="actions">
        <form method="post" action="/admin/run">
          <input type="hidden" name="sourceId" value="${escapeHtml(config.id)}" />
          <input type="hidden" name="respectIntervals" value="true" />
          <button type="submit">Run If Due</button>
        </form>
        <form method="post" action="/admin/run">
          <input type="hidden" name="sourceId" value="${escapeHtml(config.id)}" />
          <input type="hidden" name="respectIntervals" value="false" />
          <button type="submit" class="secondary">Force Run</button>
        </form>
        <form method="post" action="/admin/sources/test">
          <input type="hidden" name="sourceId" value="${escapeHtml(config.id)}" />
          <button type="submit" class="secondary">Test Source</button>
        </form>
      </div>
      <details class="editor">
        <summary>Edit source</summary>
        <form method="post" action="/admin/sources/save" class="editor-form">
          <input type="hidden" name="id" value="${escapeHtml(config.id)}" />
          <input type="hidden" name="type" value="${escapeHtml(config.type)}" />
          ${renderField({ label: "Name", name: "name", value: config.name, required: true })}
          ${renderScheduleEditor({
            intervalMinutes: config.intervalMinutes,
            scheduleWindowMode: values.scheduleWindowMode,
            scheduleStartDay: values.scheduleStartDay,
            scheduleEndDay: values.scheduleEndDay,
            scheduleStartDate: values.scheduleStartDate,
            scheduleEndDate: values.scheduleEndDate,
          })}
          <label class="checkbox">
            <input type="checkbox" name="enabled" ${config.enabled !== false ? "checked" : ""} />
            <span>Enabled</span>
          </label>
          ${renderSourceSpecificFields(config)}
          <div class="form-actions">
            <button type="submit">Save Changes</button>
          </div>
        </form>
        <form method="post" action="/admin/sources/delete" class="delete-form">
          <input type="hidden" name="sourceId" value="${escapeHtml(config.id)}" />
          <button type="submit" class="danger">Delete Source</button>
        </form>
      </details>
    </section>
  `;
}

function renderNewSourceForm(): string {
  const manualExample = JSON.stringify({
    releases: [
      {
        id: "manual-release-2026-04",
        title: "Manual release April 2026",
        source: "Manual import",
        publishedAt: "2026-04-01T00:00:00Z",
        url: null,
        items: [
          {
            articleNumber: "12345602",
            producer: "Example Brewery",
            name: "Example Beer",
            style: "IPA",
            abv: 6.5,
            country: "Norge",
            releaseDate: "2026-04-02",
          },
        ],
      },
    ],
  }, null, 2);

  return `
    <section class="panel">
      <h2>Add source</h2>
      <p class="muted">Create feeds from JSON, RSS, CSV, manual imports or site-specific scrapers.</p>
      <div class="preset-grid">
        <details class="editor">
          <summary>Add RSS source</summary>
          <form method="post" action="/admin/sources/save" class="editor-form">
            <input type="hidden" name="type" value="rss_feed" />
            ${renderField({ label: "ID", name: "id", value: "rss-feed", required: true })}
            ${renderField({ label: "Name", name: "name", value: "RSS release feed", required: true })}
            ${renderScheduleEditor({ intervalMinutes: 360 })}
            <label class="checkbox"><input type="checkbox" name="enabled" checked /><span>Enabled</span></label>
            ${renderField({ label: "Feed URL", name: "url", value: "https://example.com/feed.xml", type: "url", required: true })}
            ${renderField({ label: "Max items", name: "maxItems", value: 20, type: "number" })}
            <div class="form-actions"><button type="submit">Create Source</button></div>
          </form>
        </details>
        <details class="editor">
          <summary>Add CSV import</summary>
          <form method="post" action="/admin/sources/save" class="editor-form">
            <input type="hidden" name="type" value="csv_import" />
            ${renderField({ label: "ID", name: "id", value: "csv-import", required: true })}
            ${renderField({ label: "Name", name: "name", value: "CSV import", required: true })}
            ${renderScheduleEditor({ intervalMinutes: 1440 })}
            <label class="checkbox"><input type="checkbox" name="enabled" checked /><span>Enabled</span></label>
            ${renderField({ label: "Path", name: "path", value: "./releases.csv" })}
            ${renderField({ label: "URL", name: "url", value: "", type: "url" })}
            ${renderField({ label: "Delimiter", name: "delimiter", value: "," })}
            ${renderField({ label: "Release ID", name: "releaseId", value: "csv-release-2026-04", required: true })}
            ${renderField({ label: "Release title", name: "releaseTitle", value: "CSV import release April 2026", required: true })}
            ${renderField({ label: "Published at", name: "publishedAt", value: "2026-04-01T00:00:00Z", required: true })}
            ${renderField({ label: "Article number column", name: "articleNumberColumn", value: "articleNumber" })}
            ${renderField({ label: "Producer column", name: "producerColumn", value: "producer" })}
            ${renderField({ label: "Name column", name: "nameColumn", value: "name" })}
            ${renderField({ label: "Style column", name: "styleColumn", value: "style" })}
            ${renderField({ label: "ABV column", name: "abvColumn", value: "abv" })}
            ${renderField({ label: "Country column", name: "countryColumn", value: "country" })}
            ${renderField({ label: "Release date column", name: "releaseDateColumn", value: "releaseDate" })}
            <div class="form-actions"><button type="submit">Create Source</button></div>
          </form>
        </details>
        <details class="editor">
          <summary>Add manual import</summary>
          <form method="post" action="/admin/sources/save" class="editor-form">
            <input type="hidden" name="type" value="manual_import" />
            ${renderField({ label: "ID", name: "id", value: "manual-import", required: true })}
            ${renderField({ label: "Name", name: "name", value: "Manual import", required: true })}
            ${renderScheduleEditor({ intervalMinutes: 0 })}
            <label class="checkbox"><input type="checkbox" name="enabled" checked /><span>Enabled</span></label>
            ${renderTextArea({ label: "Release JSON", name: "manualPayload", value: manualExample, rows: 16, required: true })}
            <div class="form-actions"><button type="submit">Create Source</button></div>
          </form>
        </details>
        <details class="editor">
          <summary>Add HTTP JSON source</summary>
          <form method="post" action="/admin/sources/save" class="editor-form">
            <input type="hidden" name="type" value="http_json" />
            ${renderField({ label: "ID", name: "id", value: "remote-json", required: true })}
            ${renderField({ label: "Name", name: "name", value: "Remote JSON feed", required: true })}
            ${renderScheduleEditor({ intervalMinutes: 60 })}
            <label class="checkbox"><input type="checkbox" name="enabled" checked /><span>Enabled</span></label>
            ${renderField({ label: "URL", name: "url", value: "https://example.com/releases.json", type: "url", required: true })}
            <div class="form-actions"><button type="submit">Create Source</button></div>
          </form>
        </details>
        <details class="editor">
          <summary>Add local file source</summary>
          <form method="post" action="/admin/sources/save" class="editor-form">
            <input type="hidden" name="type" value="file_json" />
            ${renderField({ label: "ID", name: "id", value: "local-file", required: true })}
            ${renderField({ label: "Name", name: "name", value: "Local release file", required: true })}
            ${renderScheduleEditor({ intervalMinutes: 60 })}
            <label class="checkbox"><input type="checkbox" name="enabled" checked /><span>Enabled</span></label>
            ${renderField({ label: "Path", name: "path", value: "./example-releases.json", required: true })}
            <div class="form-actions"><button type="submit">Create Source</button></div>
          </form>
        </details>
        <details class="editor">
          <summary>Add Ølbloggen monthly source</summary>
          <form method="post" action="/admin/sources/save" class="editor-form">
            <input type="hidden" name="type" value="olbloggen_vinmonopolet" />
            ${renderField({ label: "ID", name: "id", value: "olbloggen-monthly", required: true })}
            ${renderField({ label: "Name", name: "name", value: "Ølbloggen monthly Vinmonopolet releases", required: true })}
            ${renderScheduleEditor({ intervalMinutes: 43200, scheduleWindowMode: "monthly_window", scheduleStartDay: "25", scheduleEndDay: "5" })}
            <label class="checkbox"><input type="checkbox" name="enabled" checked /><span>Enabled</span></label>
            ${renderField({ label: "Listing URL", name: "listingUrl", value: "https://www.olbloggen.no/category/vinmonopolet-nyheter/", type: "url", required: true })}
            ${renderField({ label: "Max pages", name: "maxPages", value: 1, type: "number" })}
            ${renderField({ label: "Max articles", name: "maxArticles", value: 6, type: "number" })}
            ${renderField({ label: "Title prefix", name: "titlePrefix", value: "Ølnyheter på Vinmonopolet" })}
            <div class="form-actions"><button type="submit">Create Source</button></div>
          </form>
        </details>
      </div>
    </section>
  `;
}

function renderSettingsPanel(settings: CollectorSettings): string {
  const webhookEnabled = settings.webhook?.enabled === true;
  const webhookUrl = settings.webhook?.url ?? "";
  const webhookFormat = settings.webhook?.format ?? "generic";

  return `
    <section class="panel">
      <h2>Collector settings</h2>
      <form method="post" action="/admin/settings/save" class="editor-form">
        <label class="checkbox">
          <input type="checkbox" name="webhookEnabled" ${webhookEnabled ? "checked" : ""} />
          <span>Enable webhook notifications</span>
        </label>
        <div class="subgrid">
          ${renderField({ label: "Webhook URL", name: "webhookUrl", value: webhookUrl, type: "url", placeholder: "https://hooks.slack.com/..." })}
          ${renderSelect({
            label: "Webhook format",
            name: "webhookFormat",
            value: webhookFormat,
            options: [
              { value: "generic", label: "Generic JSON" },
              { value: "slack", label: "Slack" },
              { value: "discord", label: "Discord" },
            ],
          })}
        </div>
        <div class="form-actions">
          <button type="submit">Save Settings</button>
        </div>
      </form>
    </section>
  `;
}

function renderExportPanel(): string {
  return `
    <section class="panel">
      <h2>Backup and export</h2>
      <p class="muted">Download the current config, a full JSON bundle, or the raw SQLite database. You can also create a server-side snapshot under the collector data directory.</p>
      <div class="actions">
        <a class="button-link secondary" href="/admin/export/config">Download config</a>
        <a class="button-link secondary" href="/admin/export/bundle">Download bundle</a>
        <a class="button-link secondary" href="/admin/export/database">Download database</a>
        <form method="post" action="/admin/backups/create">
          <button type="submit">Create Backup Snapshot</button>
        </form>
      </div>
    </section>
  `;
}

function renderImportPanel(): string {
  return `
    <section class="panel">
      <h2>Import and restore</h2>
      <p class="muted">Paste or upload a config, bundle or raw SQLite database. Every restore goes through a preview step, and the collector creates a backup snapshot before applying it.</p>
      <div class="grid three-up">
        <section class="card">
          <h3>Import config</h3>
          <p class="muted">Replaces settings and source definitions. Stored releases and run history stay untouched.</p>
          <form method="post" action="/admin/import/preview" class="editor-form">
            <input type="hidden" name="importType" value="config" />
            ${renderFileInput({
              label: "Upload config file",
              accept: "application/json,.json",
              targetField: "configPayload",
              mode: "text",
            })}
            ${renderTextArea({
              label: "Collector config JSON",
              name: "configPayload",
              placeholder: "{\n  \"settings\": {},\n  \"sources\": []\n}",
              rows: 14,
              required: true,
            })}
            <div class="form-actions">
              <button type="submit">Preview Config Import</button>
            </div>
          </form>
        </section>
        <section class="card">
          <h3>Restore full bundle</h3>
          <p class="muted">Replaces settings, sources, releases, source snapshots and run history from a bundle export.</p>
          <form method="post" action="/admin/import/preview" class="editor-form">
            <input type="hidden" name="importType" value="bundle" />
            ${renderFileInput({
              label: "Upload bundle file",
              accept: "application/json,.json",
              targetField: "bundlePayload",
              mode: "text",
            })}
            ${renderTextArea({
              label: "Bundle JSON",
              name: "bundlePayload",
              placeholder: "{\n  \"exportedAt\": \"...\",\n  \"service\": \"polvenn-release-collector\"\n}",
              rows: 14,
              required: true,
            })}
            <div class="form-actions">
              <button type="submit" class="danger">Preview Bundle Restore</button>
            </div>
          </form>
        </section>
        <section class="card">
          <h3>Restore raw database</h3>
          <p class="muted">Replaces only the SQLite database file. Current source config stays as-is.</p>
          <form method="post" action="/admin/import/preview" class="editor-form">
            <input type="hidden" name="importType" value="database" />
            ${renderFileInput({
              label: "Upload database file",
              accept: ".db,application/octet-stream",
              targetField: "databasePayload",
              mode: "data-url",
            })}
            ${renderTextArea({
              label: "Database payload",
              name: "databasePayload",
              placeholder: "Choose a .db file above to populate this field automatically.",
              rows: 8,
              required: true,
            })}
            <div class="form-actions">
              <button type="submit" class="danger">Preview Database Restore</button>
            </div>
          </form>
        </section>
      </div>
    </section>
  `;
}

function renderImportPreviewPanel(preview: ImportPreviewSummary | null | undefined): string {
  if (!preview) {
    return "";
  }

  const selectionControls = [
    preview.type !== "database" ? `
      <label class="checkbox">
        <input type="checkbox" name="applySettings" ${preview.defaultSelection.applySettings ? "checked" : ""} />
        <span>Apply settings</span>
      </label>
      <label class="checkbox">
        <input type="checkbox" name="applySources" ${preview.defaultSelection.applySources ? "checked" : ""} />
        <span>Apply source definitions</span>
      </label>
    ` : "",
    preview.type !== "config" ? `
      <label class="checkbox">
        <input type="checkbox" name="applyReleases" ${preview.defaultSelection.applyReleases ? "checked" : ""} />
        <span>Apply releases</span>
      </label>
      <label class="checkbox">
        <input type="checkbox" name="applySourceRuns" ${preview.defaultSelection.applySourceRuns ? "checked" : ""} />
        <span>Apply source run snapshots</span>
      </label>
      <label class="checkbox">
        <input type="checkbox" name="applyRunHistory" ${preview.defaultSelection.applyRunHistory ? "checked" : ""} />
        <span>Apply run history</span>
      </label>
    ` : `
      <input type="hidden" name="applyReleases" value="false" />
      <input type="hidden" name="applySourceRuns" value="false" />
      <input type="hidden" name="applyRunHistory" value="false" />
    `,
  ].join("");

  return `
    <section class="panel">
      <h2>Restore preview</h2>
      <div class="card">
        <div class="card-header">
          <div>
            <h3>${escapeHtml(preview.title)}</h3>
            <p class="muted">${escapeHtml(preview.type)} · created ${escapeHtml(preview.createdAt)}</p>
          </div>
          <span class="badge due">pending</span>
        </div>
        <ul>
          ${preview.details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}
        </ul>
        <h4>Changes against current state</h4>
        <ul>
          ${preview.changes.map((change) => `<li>${escapeHtml(change)}</li>`).join("")}
        </ul>
        ${preview.warning ? `<p class="error-text">${escapeHtml(preview.warning)}</p>` : ""}
        <div class="actions">
          <form method="post" action="/admin/import/apply">
            <input type="hidden" name="previewId" value="${escapeHtml(preview.id)}" />
            ${preview.type === "database" ? `
              <input type="hidden" name="applySettings" value="false" />
              <input type="hidden" name="applySources" value="false" />
            ` : ""}
            <div class="subgrid">
              ${selectionControls}
            </div>
            <button type="submit" class="danger">Apply Restore</button>
          </form>
          <form method="post" action="/admin/import/cancel">
            <input type="hidden" name="previewId" value="${escapeHtml(preview.id)}" />
            <button type="submit" class="secondary">Cancel</button>
          </form>
        </div>
      </div>
    </section>
  `;
}

function renderLastActionSection(runs: SourceRunResult[] | null): string {
  if (!runs || runs.length === 0) {
    return "";
  }

  return `
    <section class="panel">
      <h2>Last action</h2>
      <div class="history-stack">
        ${runs.map((run) => `
          <details class="history-item">
            <summary>${escapeHtml(summarizeRunResult(run))}</summary>
            <div class="history-body">
              ${renderDiffList(run.diff.newReleases)}
              ${run.status === "error" && run.reason ? `<p class="error-text">${escapeHtml(run.reason)}</p>` : ""}
            </div>
          </details>
        `).join("")}
      </div>
    </section>
  `;
}

function renderHistorySection(runs: SourceRunHistoryEntry[]): string {
  if (runs.length === 0) {
    return "";
  }

  return `
    <section class="panel">
      <h2>Run history</h2>
      <div class="history-stack">
        ${runs.map((run) => `
          <details class="history-item">
            <summary>${escapeHtml(summarizeHistoryEntry(run))}</summary>
            <div class="history-body">
              ${renderDiffList(run.diff.newReleases)}
              ${run.status === "error" && run.errorMessage ? `<p class="error-text">${escapeHtml(run.errorMessage)}</p>` : ""}
            </div>
          </details>
        `).join("")}
      </div>
    </section>
  `;
}

export function renderAdminLoginPage(params: {
  serviceName: string;
  message?: string | null;
}): string {
  const { serviceName, message = null } = params;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(serviceName)} admin</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: linear-gradient(180deg, #f7f3ea 0%, #efe6d8 100%);
        color: #241f16;
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif;
      }
      .panel {
        width: min(420px, calc(100vw - 32px));
        background: rgba(255, 253, 248, 0.96);
        border: 1px solid #d8d1c4;
        border-radius: 24px;
        padding: 28px;
        box-shadow: 0 16px 40px rgba(36, 31, 22, 0.08);
      }
      input, button {
        width: 100%;
        font: inherit;
        border-radius: 14px;
        padding: 12px 14px;
      }
      input {
        border: 1px solid #d8d1c4;
        margin-bottom: 12px;
      }
      button {
        border: 0;
        background: #0b6e4f;
        color: white;
        cursor: pointer;
      }
      .message {
        border-radius: 14px;
        padding: 12px 14px;
        margin-bottom: 14px;
      }
      .message.error {
        background: #f8dede;
        color: #9f1d1d;
      }
    </style>
  </head>
  <body>
    <main class="panel">
      <h1>${escapeHtml(serviceName)} admin</h1>
      <p>Log in with the collector admin token.</p>
      ${renderMessage(message, "error")}
      <form method="post" action="/admin/login">
        <input type="password" name="token" placeholder="Admin token" autocomplete="current-password" required />
        <button type="submit">Log in</button>
      </form>
    </main>
  </body>
</html>`;
}

export function renderAdminDashboardPage(params: {
  serviceName: string;
  sourceConfigs: SourceConfig[];
  sourceStatuses: SourceStatus[];
  collectorSettings: CollectorSettings;
  importPreview?: ImportPreviewSummary | null;
  runHistory?: SourceRunHistoryEntry[];
  lastRunResults?: SourceRunResult[] | null;
  message?: string | null;
  tone?: "success" | "error" | "info";
}): string {
  const {
    serviceName,
    sourceConfigs,
    sourceStatuses,
    collectorSettings,
    importPreview = null,
    runHistory = [],
    lastRunResults = null,
    message = null,
    tone = "info",
  } = params;

  const statusesById = new Map(sourceStatuses.map((status) => [status.sourceId, status]));
  const sourceCards = sourceConfigs
    .map((config) => renderSourceEditorCard(config, statusesById.get(config.id)))
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(serviceName)} admin</title>
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
        max-width: 1280px;
        margin: 0 auto;
        padding: 36px 20px 64px;
      }
      .topbar, .panel, .card {
        background: rgba(255, 253, 248, 0.94);
        border: 1px solid var(--line);
        border-radius: 24px;
        box-shadow: 0 16px 40px rgba(36, 31, 22, 0.08);
      }
      .topbar {
        padding: 24px;
        display: flex;
        justify-content: space-between;
        gap: 20px;
        align-items: start;
        flex-wrap: wrap;
      }
      .top-actions, .actions, .form-actions, .preset-grid, .subgrid, .chips {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      .top-actions form,
      .actions form {
        margin: 0;
      }
      .button-link,
      button,
      input,
      select,
      textarea {
        font: inherit;
      }
      .panel {
        padding: 18px 20px;
        margin-top: 18px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
        gap: 18px;
        margin-top: 18px;
      }
      .grid.two-up {
        margin-top: 0;
      }
      .grid.three-up {
        margin-top: 0;
      }
      .card {
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
      .message {
        border-radius: 14px;
        padding: 12px 14px;
        margin-top: 18px;
      }
      .message.success { background: #daf0e6; color: var(--accent); }
      .message.error { background: #f8dede; color: var(--error); }
      .message.info { background: #ece6da; color: var(--muted); }
      dl {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px 14px;
      }
      dt {
        font-size: 0.85rem;
        color: var(--muted);
      }
      dd {
        margin: 4px 0 0;
      }
      .field {
        display: grid;
        gap: 6px;
        min-width: 0;
      }
      .editor-form {
        display: grid;
        gap: 12px;
        margin-top: 14px;
      }
      .editor summary {
        cursor: pointer;
        font-weight: 600;
      }
      input, select, textarea, button, .button-link {
        border-radius: 14px;
        padding: 10px 12px;
      }
      input, select, textarea {
        border: 1px solid var(--line);
        background: white;
      }
      textarea {
        width: 100%;
        resize: vertical;
      }
      button, .button-link {
        border: 0;
        background: var(--accent);
        color: white;
        cursor: pointer;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      button.secondary, .button-link.secondary {
        background: #ece6da;
        color: var(--ink);
      }
      button.danger {
        background: var(--error);
      }
      .checkbox {
        display: flex;
        gap: 10px;
        align-items: center;
      }
      .checkbox input {
        width: auto;
      }
      .delete-form {
        margin-top: 14px;
      }
      .error-text {
        color: var(--error);
      }
      .history-stack {
        display: grid;
        gap: 12px;
      }
      .history-item {
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 12px 14px;
        background: #fff;
      }
      .history-item summary {
        cursor: pointer;
      }
      .history-body {
        margin-top: 10px;
      }
      .diff-list {
        display: grid;
        gap: 10px;
        padding-left: 18px;
      }
      .chip {
        background: #ece6da;
        padding: 4px 8px;
        border-radius: 999px;
        font-size: 0.85rem;
      }
      @media (max-width: 760px) {
        dl {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="topbar">
        <div>
          <h1>${escapeHtml(serviceName)} admin</h1>
          <p class="muted">Manage sources, schedules, webhook notifications and backup/export for beer.ogard.cloud.</p>
        </div>
        <div class="top-actions">
          <form method="post" action="/admin/run">
            <input type="hidden" name="respectIntervals" value="true" />
            <button type="submit">Run Due Sources</button>
          </form>
          <form method="post" action="/admin/run">
            <input type="hidden" name="respectIntervals" value="false" />
            <button type="submit" class="secondary">Force Run All</button>
          </form>
          <form method="post" action="/admin/logout">
            <button type="submit" class="secondary">Log out</button>
          </form>
        </div>
      </section>
      ${renderMessage(message, tone)}
      ${renderSettingsPanel(collectorSettings)}
      ${renderExportPanel()}
      ${renderImportPanel()}
      ${renderImportPreviewPanel(importPreview)}
      ${renderLastActionSection(lastRunResults)}
      ${renderHistorySection(runHistory)}
      ${renderNewSourceForm()}
      <section class="grid">
        ${sourceCards || `<section class="panel"><p class="muted">No sources configured yet.</p></section>`}
      </section>
      <script>
        for (const input of document.querySelectorAll('input[type="file"][data-file-target]')) {
          input.addEventListener('change', () => {
            const fieldName = input.getAttribute('data-file-target');
            const mode = input.getAttribute('data-file-mode') || 'text';
            const file = input.files && input.files[0];
            if (!fieldName || !file) {
              return;
            }

            const target = document.querySelector('[name="' + fieldName + '"]');
            if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) {
              return;
            }

            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === 'string') {
                target.value = reader.result;
              }
            };

            if (mode === 'data-url') {
              reader.readAsDataURL(file);
            } else {
              reader.readAsText(file);
            }
          });
        }
      </script>
    </main>
  </body>
</html>`;
}
