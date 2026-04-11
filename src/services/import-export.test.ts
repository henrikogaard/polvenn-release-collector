import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ReleaseDatabase } from "../db/database.js";
import {
  buildBundlePreviewSummary,
  buildConfigPreviewSummary,
  buildDatabasePreviewSummary,
  decodeBase64FilePayload,
  parseRestoreSelection,
  parseCollectorConfigImport,
  parseCollectorExportBundle,
} from "./import-export.js";

test("parseCollectorConfigImport parses exported collector config payload", () => {
  const parsed = parseCollectorConfigImport(JSON.stringify({
    settings: {
      webhook: {
        enabled: true,
        url: "https://hooks.slack.com/services/test",
        format: "slack",
      },
    },
    sources: [
      {
        id: "rss-feed",
        name: "RSS feed",
        type: "rss_feed",
        enabled: true,
        intervalMinutes: 360,
        url: "https://example.com/feed.xml",
      },
    ],
  }));

  assert.equal(parsed.settings?.webhook?.enabled, true);
  assert.equal(parsed.sources[0]?.type, "rss_feed");
});

test("parseCollectorExportBundle parses full bundle payload", () => {
  const parsed = parseCollectorExportBundle(JSON.stringify({
    exportedAt: "2026-04-09T12:00:00.000Z",
    service: "polvenn-release-collector",
    host: "beer.ogard.cloud",
    settings: {
      webhook: {
        enabled: true,
        url: "https://discord.com/api/webhooks/test",
        format: "discord",
      },
    },
    sources: [
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
    ],
    sourceRuns: [
      {
        sourceId: "manual-import",
        lastRunAt: "2026-04-09T11:00:00.000Z",
        lastSuccessAt: "2026-04-09T11:00:00.000Z",
        lastErrorAt: null,
        lastErrorMessage: null,
        lastStatus: "success",
        lastRunDurationMs: 123,
      },
    ],
    recentRuns: [
      {
        runId: "manual-import:2026-04-09T11:00:00.000Z",
        sourceId: "manual-import",
        sourceName: "Manual import",
        trigger: "manual",
        status: "success",
        startedAt: "2026-04-09T11:00:00.000Z",
        completedAt: "2026-04-09T11:00:01.000Z",
        durationMs: 1000,
        releasesCollected: 1,
        newReleaseCount: 1,
        newReleaseTitles: ["Manual release"],
        diff: {
          newReleases: [
            {
              releaseId: "manual-release",
              title: "Manual release",
              publishedAt: "2026-04-01T00:00:00Z",
              url: null,
              itemCount: 0,
              itemNames: [],
            },
          ],
        },
        errorMessage: null,
        persisted: true,
        respectedIntervals: false,
      },
    ],
    latestReleases: [
      {
        id: "manual-release",
        title: "Manual release",
        source: "Manual import",
        publishedAt: "2026-04-01T00:00:00Z",
        url: null,
        items: [],
      },
    ],
  }));

  assert.equal(parsed.sourceRuns.length, 1);
  assert.equal(parsed.recentRuns.length, 1);
  assert.equal(parsed.latestReleases[0]?.id, "manual-release");
});

test("decodeBase64FilePayload supports data URLs", () => {
  const buffer = decodeBase64FilePayload("data:application/octet-stream;base64,aGVsbG8=");
  assert.equal(buffer.toString("utf8"), "hello");
});

test("preview summary helpers produce readable summaries", () => {
  const configPreview = buildConfigPreviewSummary({
    id: "config-preview",
    currentConfig: {
      settings: {},
      sources: [],
    },
    importedConfig: {
      settings: {
        webhook: {
          enabled: true,
          url: "https://hooks.slack.com/services/test",
          format: "slack",
        },
      },
      sources: [
        {
          id: "rss-feed",
          name: "RSS feed",
          type: "rss_feed",
          enabled: true,
          url: "https://example.com/feed.xml",
        },
      ],
    },
  });
  assert.equal(configPreview.type, "config");
  assert.match(configPreview.changes[0] ?? "", /Adds 1 source/);
  assert.equal(configPreview.defaultSelection.applySettings, true);
  assert.equal(configPreview.defaultSelection.applyReleases, false);

  const bundlePreview = buildBundlePreviewSummary({
    id: "bundle-preview",
    currentConfig: {
      settings: {},
      sources: [],
    },
    currentStats: {
      releaseCount: 2,
      sourceRunCount: 1,
      runHistoryCount: 4,
    },
    importedBundle: {
      exportedAt: "2026-04-09T12:00:00.000Z",
      service: "polvenn-release-collector",
      host: "beer.ogard.cloud",
      settings: {},
      sources: [],
      sourceRuns: [],
      recentRuns: [],
      latestReleases: [],
    },
  });
  assert.equal(bundlePreview.type, "bundle");
  assert.match(bundlePreview.details[1] ?? "", /Releases: 2 -> 0/);
  assert.equal(bundlePreview.defaultSelection.applyRunHistory, true);

  const dbPreview = buildDatabasePreviewSummary({
    id: "db-preview",
    sizeBytes: 1024,
    currentReleaseCount: 10,
    currentSourceRunCount: 2,
    currentRunHistoryCount: 7,
    releaseCount: 4,
    sourceRunCount: 2,
    runHistoryCount: 8,
  });
  assert.equal(dbPreview.type, "database");
  assert.match(dbPreview.details[1] ?? "", /Releases: 10 -> 4/);
  assert.equal(dbPreview.defaultSelection.applySources, false);
});

test("parseRestoreSelection reads checkbox-style payloads", () => {
  const selection = parseRestoreSelection({
    applySettings: "on",
    applySources: "on",
    applyReleases: "true",
    applySourceRuns: "false",
  });

  assert.deepEqual(selection, {
    applySettings: true,
    applySources: true,
    applyReleases: true,
    applySourceRuns: false,
    applyRunHistory: false,
  });
});

test("replaceAllData restores releases, source snapshots and run history", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "polvenn-import-export-test-"));
  const dbPath = path.join(tempDir, "collector.db");
  const db = new ReleaseDatabase(dbPath);
  await db.init();

  db.replaceAllData({
    releases: [
      {
        id: "restored-release",
        title: "Restored release",
        source: "Manual import",
        publishedAt: "2026-04-01T00:00:00Z",
        url: null,
        items: [
          {
            articleNumber: "12345602",
            producer: "Example Brewery",
            name: "Restored Beer",
            style: "IPA",
            abv: 6.5,
            country: "Norge",
            releaseDate: "2026-04-03",
          },
        ],
      },
    ],
    sourceRuns: [
      {
        sourceId: "manual-import",
        lastRunAt: "2026-04-09T11:00:00.000Z",
        lastSuccessAt: "2026-04-09T11:00:00.000Z",
        lastErrorAt: null,
        lastErrorMessage: null,
        lastStatus: "success",
        lastRunDurationMs: 123,
      },
    ],
    runHistory: [
      {
        runId: "manual-import:2026-04-09T11:00:00.000Z",
        sourceId: "manual-import",
        sourceName: "Manual import",
        trigger: "manual",
        status: "success",
        startedAt: "2026-04-09T11:00:00.000Z",
        completedAt: "2026-04-09T11:00:01.000Z",
        durationMs: 1000,
        releasesCollected: 1,
        newReleaseCount: 1,
        newReleaseTitles: ["Restored release"],
        diff: {
          newReleases: [
            {
              releaseId: "restored-release",
              title: "Restored release",
              publishedAt: "2026-04-01T00:00:00Z",
              url: null,
              itemCount: 1,
              itemNames: ["Example Brewery Restored Beer"],
            },
          ],
        },
        errorMessage: null,
        persisted: true,
        respectedIntervals: false,
      },
    ],
  });

  const releases = db.listLatestReleases(10);
  const sourceRuns = db.listSourceRuns();
  const runHistory = db.listSourceRunHistory(10);
  const stats = db.getStats();

  assert.equal(releases.length, 1);
  assert.equal(releases[0]?.items[0]?.name, "Restored Beer");
  assert.equal(sourceRuns.length, 1);
  assert.equal(sourceRuns[0]?.sourceId, "manual-import");
  assert.equal(runHistory.length, 1);
  assert.equal(runHistory[0]?.diff.newReleases[0]?.releaseId, "restored-release");
  assert.equal(stats.releaseCount, 1);
  assert.equal(stats.sourceRunCount, 1);
});
