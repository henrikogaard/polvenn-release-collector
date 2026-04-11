import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ReleaseDatabase } from "../db/database.js";
import { collectSources, getNextDueAt, listSourceStatuses, shouldCollectSource } from "./collector.js";

test("collectSources respects per-source intervals when requested", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "polvenn-collector-test-"));
  const releasesPath = path.join(tempDir, "releases.json");
  const configPath = path.join(tempDir, "sources.json");
  const dbPath = path.join(tempDir, "collector.db");

  await fs.writeFile(
    releasesPath,
    JSON.stringify({
      releases: [
        {
          id: "test-release",
          title: "Test release",
          source: "example-file",
          publishedAt: "2026-04-01T00:00:00Z",
          url: "https://example.com/releases/test-release",
          items: [
            {
              country: "Norge",
              articleNumber: "20162402",
              producer: "Amundsen Bryggeri",
              name: "Example Beer",
              style: "Imperial Stout",
              abv: 12,
              releaseDate: "2026-04-01",
            },
          ],
        },
      ],
    }),
    "utf8",
  );

  await fs.writeFile(
    configPath,
    JSON.stringify({
      sources: [
        {
          id: "example-file",
          name: "Example local release file",
          type: "file_json",
          enabled: true,
          intervalMinutes: 60,
          path: releasesPath,
        },
      ],
    }),
    "utf8",
  );

  const db = new ReleaseDatabase(dbPath);
  await db.init();

  const firstRun = await collectSources(db, configPath, {
    respectIntervals: true,
    now: new Date("2026-04-01T10:00:00Z"),
  });

  assert.equal(firstRun.length, 1);
  assert.equal(firstRun[0]?.status, "success");
  assert.equal(firstRun[0]?.skipped, false);
  assert.equal(firstRun[0]?.releasesCollected, 1);
  assert.equal(firstRun[0]?.newReleaseCount, 1);
  assert.equal(firstRun[0]?.diff.newReleases.length, 1);
  assert.equal(firstRun[0]?.lastRunAt, "2026-04-01T10:00:00.000Z");

  const secondRun = await collectSources(db, configPath, {
    respectIntervals: true,
    now: new Date("2026-04-01T10:30:00Z"),
  });

  assert.equal(secondRun.length, 1);
  assert.equal(secondRun[0]?.status, "skipped");
  assert.equal(secondRun[0]?.skipped, true);
  assert.equal(secondRun[0]?.releasesCollected, 0);
  assert.equal(secondRun[0]?.diff.newReleases.length, 0);
  assert.equal(secondRun[0]?.lastRunAt, "2026-04-01T10:00:00.000Z");

  const thirdRun = await collectSources(db, configPath, {
    respectIntervals: true,
    now: new Date("2026-04-01T11:01:00Z"),
  });

  assert.equal(thirdRun.length, 1);
  assert.equal(thirdRun[0]?.status, "success");
  assert.equal(thirdRun[0]?.skipped, false);
  assert.equal(thirdRun[0]?.releasesCollected, 1);
  assert.equal(thirdRun[0]?.newReleaseCount, 0);
  assert.equal(thirdRun[0]?.lastRunAt, "2026-04-01T11:01:00.000Z");

  const statuses = listSourceStatuses(db, configPath, new Date("2026-04-01T11:30:00Z"));
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0]?.lastStatus, "success");
  assert.equal(statuses[0]?.isDue, false);
  assert.equal(statuses[0]?.nextDueAt, "2026-04-01T12:01:00.000Z");
});

test("collectSources isolates per-source failures and stores source error status", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "polvenn-collector-test-"));
  const releasesPath = path.join(tempDir, "releases.json");
  const configPath = path.join(tempDir, "sources.json");
  const dbPath = path.join(tempDir, "collector.db");

  await fs.writeFile(
    releasesPath,
    JSON.stringify({
      releases: [
        {
          id: "ok-release",
          title: "OK release",
          source: "good-file",
          publishedAt: "2026-04-01T00:00:00Z",
          url: "https://example.com/releases/ok-release",
          items: [],
        },
      ],
    }),
    "utf8",
  );

  await fs.writeFile(
    configPath,
    JSON.stringify({
      sources: [
        {
          id: "good-file",
          name: "Good source",
          type: "file_json",
          enabled: true,
          path: releasesPath,
        },
        {
          id: "missing-file",
          name: "Broken source",
          type: "file_json",
          enabled: true,
          path: path.join(tempDir, "missing.json"),
        },
      ],
    }),
    "utf8",
  );

  const db = new ReleaseDatabase(dbPath);
  await db.init();

  const results = await collectSources(db, configPath, {
    now: new Date("2026-04-01T10:00:00Z"),
  });

  assert.equal(results.length, 2);
  assert.equal(results[0]?.status, "success");
  assert.equal(results[1]?.status, "error");
  assert.match(results[1]?.lastErrorMessage ?? "", /ENOENT|no such file/i);

  const releases = db.listLatestReleases(5);
  assert.equal(releases.length, 1);
  assert.equal(releases[0]?.id, "ok-release");

  const statuses = listSourceStatuses(db, configPath, new Date("2026-04-01T10:05:00Z"));
  assert.equal(statuses.length, 2);
  assert.equal(statuses[0]?.lastStatus, "success");
  assert.equal(statuses[1]?.lastStatus, "error");
  assert.match(statuses[1]?.lastErrorMessage ?? "", /ENOENT|no such file/i);
});

test("monthly schedule windows only allow runs in the configured day range", () => {
  const config = {
    id: "monthly-source",
    name: "Monthly source",
    type: "http_json" as const,
    enabled: true,
    intervalMinutes: 60,
    scheduleWindow: {
      mode: "monthly_window" as const,
      startDay: 25,
      endDay: 5,
    },
    url: "https://example.com/releases.json",
  };

  assert.equal(shouldCollectSource(config, null, new Date("2026-04-03T10:00:00Z")), true);
  assert.equal(shouldCollectSource(config, null, new Date("2026-04-14T10:00:00Z")), false);
  assert.equal(
    getNextDueAt(config, null, new Date("2026-04-14T10:00:00Z")),
    new Date(2026, 3, 25, 0, 0, 0, 0).toISOString(),
  );
});

test("date range windows stop collecting after the range ends", () => {
  const config = {
    id: "dated-source",
    name: "Date range source",
    type: "http_json" as const,
    enabled: true,
    scheduleWindow: {
      mode: "date_range" as const,
      startDate: "2026-04-01",
      endDate: "2026-04-10",
    },
    url: "https://example.com/releases.json",
  };

  assert.equal(shouldCollectSource(config, null, new Date("2026-04-05T10:00:00Z")), true);
  assert.equal(shouldCollectSource(config, null, new Date("2026-04-20T10:00:00Z")), false);
  assert.equal(getNextDueAt(config, null, new Date("2026-04-20T10:00:00Z")), null);
});
