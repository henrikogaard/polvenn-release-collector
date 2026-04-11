import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createSourceAdapter,
  loadCollectorConfig,
  loadSourceConfigs,
  parseSettingsForm,
  parseSourceConfigForm,
  removeSourceConfig,
  saveCollectorConfig,
  saveSourceConfigs,
  upsertSourceConfig,
} from "./index.js";

test("parseSourceConfigForm parses monthly window config for olbloggen source", () => {
  const parsed = parseSourceConfigForm({
    id: "olbloggen-monthly",
    name: "Ølbloggen monthly Vinmonopolet releases",
    type: "olbloggen_vinmonopolet",
    enabled: "on",
    intervalMinutes: "43200",
    scheduleWindowMode: "monthly_window",
    scheduleStartDay: "25",
    scheduleEndDay: "5",
    listingUrl: "https://www.olbloggen.no/category/vinmonopolet-nyheter/",
    maxPages: "1",
    maxArticles: "6",
    titlePrefix: "Ølnyheter på Vinmonopolet",
  });

  assert.deepEqual(parsed, {
    id: "olbloggen-monthly",
    name: "Ølbloggen monthly Vinmonopolet releases",
    type: "olbloggen_vinmonopolet",
    enabled: true,
    intervalMinutes: 43200,
    scheduleWindow: {
      mode: "monthly_window",
      startDay: 25,
      endDay: 5,
    },
    listingUrl: "https://www.olbloggen.no/category/vinmonopolet-nyheter/",
    maxPages: 1,
    maxArticles: 6,
    titlePrefix: "Ølnyheter på Vinmonopolet",
  });
});

test("parseSourceConfigForm supports rss, csv and manual import sources", () => {
  const rss = parseSourceConfigForm({
    id: "rss-feed",
    name: "RSS feed",
    type: "rss_feed",
    enabled: "on",
    schedulePreset: "daily",
    url: "https://example.com/feed.xml",
    maxItems: "12",
  });
  assert.equal(rss.type, "rss_feed");
  assert.equal(rss.intervalMinutes, 1440);

  const csv = parseSourceConfigForm({
    id: "csv-import",
    name: "CSV import",
    type: "csv_import",
    enabled: "on",
    path: "./releases.csv",
    delimiter: ";",
    releaseId: "csv-release",
    releaseTitle: "CSV release",
    publishedAt: "2026-04-01T00:00:00Z",
  });
  assert.equal(csv.type, "csv_import");
  assert.equal(csv.delimiter, ";");
  assert.equal(csv.path, "./releases.csv");

  const manual = parseSourceConfigForm({
    id: "manual-import",
    name: "Manual import",
    type: "manual_import",
    enabled: "on",
    manualPayload: JSON.stringify({
      releases: [
        {
          id: "manual-release",
          title: "Manual release",
          source: "Manual import",
          publishedAt: "2026-04-01T00:00:00Z",
          url: null,
          items: [],
        },
      ],
    }),
  });
  assert.equal(manual.type, "manual_import");
  assert.equal(manual.releases.length, 1);
});

test("settings and source config persistence keep top-level collector settings", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "polvenn-sources-test-"));
  const configPath = path.join(tempDir, "sources.json");

  saveCollectorConfig(configPath, {
    settings: {
      webhook: {
        enabled: true,
        url: "https://hooks.slack.com/services/test",
        format: "slack",
      },
    },
    sources: [
      {
        id: "example-http",
        name: "Example remote release endpoint",
        type: "http_json",
        enabled: true,
        intervalMinutes: 60,
        url: "https://example.com/releases.json",
      },
    ],
  });

  upsertSourceConfig(configPath, {
    id: "rss-feed",
    name: "RSS feed",
    type: "rss_feed",
    enabled: true,
    intervalMinutes: 360,
    url: "https://example.com/feed.xml",
    maxItems: 10,
  });

  const withNewSource = loadCollectorConfig(configPath);
  assert.equal(withNewSource.sources.length, 2);
  assert.equal(withNewSource.settings?.webhook?.format, "slack");

  removeSourceConfig(configPath, "example-http");
  const afterDelete = loadCollectorConfig(configPath);
  assert.deepEqual(afterDelete.sources.map((source) => source.id), ["rss-feed"]);
  assert.equal(afterDelete.settings?.webhook?.enabled, true);
});

test("loadSourceConfigs resolves env references in collector settings and sources", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "polvenn-sources-test-"));
  const configPath = path.join(tempDir, "sources.json");
  process.env.TEST_RELEASE_FEED_URL = "https://example.com/releases.json";
  process.env.TEST_WEBHOOK_URL = "https://hooks.slack.com/services/test";

  await fs.writeFile(
    configPath,
    JSON.stringify({
      settings: {
        webhook: {
          enabled: true,
          url: "env:TEST_WEBHOOK_URL",
          format: "slack",
        },
      },
      sources: [
        {
          id: "remote-json",
          name: "Remote JSON feed",
          type: "http_json",
          enabled: true,
          url: "env:TEST_RELEASE_FEED_URL",
        },
      ],
    }),
    "utf8",
  );

  const loaded = loadCollectorConfig(configPath);
  assert.equal(loaded.sources[0]?.type, "http_json");
  assert.equal(loaded.sources[0] && "url" in loaded.sources[0] ? loaded.sources[0].url : "", "https://example.com/releases.json");
  assert.equal(loaded.settings?.webhook?.url, "https://hooks.slack.com/services/test");
});

test("csv import adapter parses local csv rows into a release", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "polvenn-sources-test-"));
  const csvPath = path.join(tempDir, "releases.csv");

  await fs.writeFile(
    csvPath,
    [
      "articleNumber,producer,name,style,abv,country,releaseDate",
      "12345602,Example Brewery,Test Beer,IPA,6.5,Norge,2026-04-03",
    ].join("\n"),
    "utf8",
  );

  const adapter = createSourceAdapter({
    id: "csv-import",
    name: "CSV import",
    type: "csv_import",
    enabled: true,
    path: csvPath,
    releaseId: "csv-release",
    releaseTitle: "CSV release",
    publishedAt: "2026-04-01T00:00:00Z",
  });

  const releases = await adapter.collect();
  assert.equal(releases.length, 1);
  assert.equal(releases[0]?.items.length, 1);
  assert.equal(releases[0]?.items[0]?.name, "Test Beer");
});

test("parseSettingsForm parses webhook settings", () => {
  const settings = parseSettingsForm({
    webhookEnabled: "on",
    webhookUrl: "https://discord.com/api/webhooks/test",
    webhookFormat: "discord",
  });

  assert.deepEqual(settings, {
    webhook: {
      enabled: true,
      url: "https://discord.com/api/webhooks/test",
      format: "discord",
    },
  });
});

test("saveSourceConfigs remains backward-compatible for sources-only writes", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "polvenn-sources-test-"));
  const configPath = path.join(tempDir, "sources.json");

  saveCollectorConfig(configPath, {
    settings: {
      webhook: {
        enabled: true,
        url: "https://example.com/webhook",
        format: "generic",
      },
    },
    sources: [],
  });

  saveSourceConfigs(configPath, [
    {
      id: "manual-import",
      name: "Manual import",
      type: "manual_import",
      enabled: true,
      releases: [
        {
          id: "manual-release",
          title: "Manual release",
          source: "Manual import",
          publishedAt: "2026-04-01T00:00:00Z",
          url: null,
          items: [],
        },
      ],
    },
  ]);

  const loaded = loadCollectorConfig(configPath);
  assert.equal(loaded.sources.length, 1);
  assert.equal(loaded.settings?.webhook?.url, "https://example.com/webhook");
});
