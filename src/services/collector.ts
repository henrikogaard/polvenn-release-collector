import type { ReleaseDatabase } from "../db/database.js";
import type {
  ReleaseDiffSummary,
  SourceRunHistoryEntry,
  SourceRunResult,
  SourceStatus,
} from "../types/releases.js";
import type { ScheduleWindow, SourceConfig } from "../types/source.js";
import {
  createSourceAdapter,
  getScheduleWindowSummary,
  loadSourceConfigs,
} from "../sources/index.js";

interface CollectSourcesOptions {
  sourceId?: string;
  respectIntervals?: boolean;
  now?: Date;
  persistResults?: boolean;
  trigger?: SourceRunResult["trigger"];
}

function getScheduleRange(window: ScheduleWindow, now: Date): { start: Date; end: Date } | null {
  if (window.mode === "date_range") {
    const start = new Date(`${window.startDate}T00:00:00`);
    const end = new Date(`${window.endDate}T23:59:59.999`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return null;
    }

    return { start, end };
  }

  return null;
}

function buildLocalDate(year: number, month: number, day: number): Date {
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDayOfMonth), 0, 0, 0, 0);
}

export function isWithinScheduleWindow(window: ScheduleWindow | undefined, now: Date): boolean {
  if (!window || window.mode === "always") {
    return true;
  }

  if (window.mode === "monthly_window") {
    const day = now.getDate();
    if (window.startDay <= window.endDay) {
      return day >= window.startDay && day <= window.endDay;
    }

    return day >= window.startDay || day <= window.endDay;
  }

  const range = getScheduleRange(window, now);
  if (!range) {
    return true;
  }

  return now >= range.start && now <= range.end;
}

function getNextScheduleEligibleAt(window: ScheduleWindow | undefined, now: Date): Date | null {
  if (!window || window.mode === "always") {
    return new Date(now);
  }

  if (window.mode === "date_range") {
    const range = getScheduleRange(window, now);
    if (!range) {
      return new Date(now);
    }

    if (now < range.start) {
      return range.start;
    }

    if (now <= range.end) {
      return new Date(now);
    }

    return null;
  }

  if (isWithinScheduleWindow(window, now)) {
    return new Date(now);
  }

  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();

  if (window.startDay <= window.endDay) {
    if (day < window.startDay) {
      return buildLocalDate(year, month, window.startDay);
    }

    return buildLocalDate(year, month + 1, window.startDay);
  }

  if (day > window.endDay && day < window.startDay) {
    return buildLocalDate(year, month, window.startDay);
  }

  return new Date(now);
}

function buildDiffSummary(newReleaseTitles: SourceRunResult["newReleaseTitles"], releases: Array<{
  id: string;
  title: string;
  publishedAt: string;
  url: string | null;
  items: Array<{ producer: string; name: string }>;
}>): ReleaseDiffSummary {
  void newReleaseTitles;
  return {
    newReleases: releases.map((release) => ({
      releaseId: release.id,
      title: release.title,
      publishedAt: release.publishedAt,
      url: release.url,
      itemCount: release.items.length,
      itemNames: release.items.slice(0, 12).map((item) => `${item.producer} ${item.name}`.trim()),
    })),
  };
}

export function shouldCollectSource(
  config: SourceConfig,
  lastRunAt: string | null,
  now: Date,
): boolean {
  if (!isWithinScheduleWindow(config.scheduleWindow, now)) {
    return false;
  }

  if (!config.intervalMinutes || config.intervalMinutes <= 0) {
    return true;
  }

  if (!lastRunAt) {
    return true;
  }

  const lastRunTimestamp = new Date(lastRunAt).getTime();
  if (Number.isNaN(lastRunTimestamp)) {
    return true;
  }

  const intervalMs = config.intervalMinutes * 60_000;
  return now.getTime() - lastRunTimestamp >= intervalMs;
}

export function getNextDueAt(
  config: SourceConfig,
  lastRunAt: string | null,
  now = new Date(),
): string | null {
  const nextScheduleTime = getNextScheduleEligibleAt(config.scheduleWindow, now);
  if (!nextScheduleTime) {
    return null;
  }

  if (shouldCollectSource(config, lastRunAt, now)) {
    return now.toISOString();
  }

  if (!config.intervalMinutes || config.intervalMinutes <= 0 || !lastRunAt) {
    return nextScheduleTime.toISOString();
  }

  const lastRunTimestamp = new Date(lastRunAt).getTime();
  if (Number.isNaN(lastRunTimestamp)) {
    return nextScheduleTime.toISOString();
  }

  const intervalDueTime = new Date(lastRunTimestamp + (config.intervalMinutes * 60_000));
  const nextDueTimestamp = Math.max(intervalDueTime.getTime(), nextScheduleTime.getTime());
  return new Date(nextDueTimestamp).toISOString();
}

export function listSourceStatuses(
  db: ReleaseDatabase,
  configPath: string,
  now = new Date(),
): SourceStatus[] {
  return loadSourceConfigs(configPath).map((config) => {
    const runInfo = db.getSourceRunInfo(config.id);
    return {
      sourceId: config.id,
      sourceName: config.name,
      sourceType: config.type,
      enabled: config.enabled !== false,
      intervalMinutes: config.intervalMinutes ?? null,
      scheduleSummary: getScheduleWindowSummary(config.scheduleWindow),
      lastRunAt: runInfo.lastRunAt,
      lastSuccessAt: runInfo.lastSuccessAt,
      lastErrorAt: runInfo.lastErrorAt,
      lastErrorMessage: runInfo.lastErrorMessage,
      lastStatus: runInfo.lastStatus,
      lastRunDurationMs: runInfo.lastRunDurationMs,
      nextDueAt: getNextDueAt(config, runInfo.lastRunAt, now),
      isDue: config.enabled !== false && shouldCollectSource(config, runInfo.lastRunAt, now),
    };
  });
}

export async function collectSources(
  db: ReleaseDatabase,
  configPath: string,
  options: CollectSourcesOptions = {},
): Promise<SourceRunResult[]> {
  const {
    sourceId,
    respectIntervals = false,
    now = new Date(),
    persistResults = true,
    trigger = "manual",
  } = options;
  const configs = loadSourceConfigs(configPath)
    .filter((config) => config.enabled !== false)
    .filter((config) => sourceId ? config.id === sourceId : true);

  const results: SourceRunResult[] = [];

  for (const config of configs) {
    const runInfo = db.getSourceRunInfo(config.id);
    if (respectIntervals && !shouldCollectSource(config, runInfo.lastRunAt, now)) {
      const skippedReason = isWithinScheduleWindow(config.scheduleWindow, now)
        ? `Not due yet. Next eligible run is ${config.intervalMinutes} minute(s) after the previous run.`
        : `Outside allowed schedule window (${getScheduleWindowSummary(config.scheduleWindow)}).`;
      const skippedResult: SourceRunResult = {
        sourceId: config.id,
        sourceName: config.name,
        releasesCollected: 0,
        newReleaseCount: 0,
        newReleaseTitles: [],
        diff: { newReleases: [] },
        status: "skipped",
        lastRunAt: runInfo.lastRunAt,
        lastSuccessAt: runInfo.lastSuccessAt,
        lastErrorAt: runInfo.lastErrorAt,
        lastErrorMessage: runInfo.lastErrorMessage,
        durationMs: runInfo.lastRunDurationMs,
        nextDueAt: getNextDueAt(config, runInfo.lastRunAt, now),
        skipped: true,
        reason: skippedReason,
        persisted: persistResults,
        trigger,
      };
      db.recordSourceRunHistory({
        runId: `${config.id}:${new Date().toISOString()}`,
        sourceId: config.id,
        sourceName: config.name,
        trigger,
        status: "skipped",
        startedAt: now.toISOString(),
        completedAt: now.toISOString(),
        durationMs: 0,
        releasesCollected: 0,
        newReleaseCount: 0,
        newReleaseTitles: [],
        diff: { newReleases: [] },
        errorMessage: skippedResult.reason,
        persisted: persistResults,
        respectedIntervals: respectIntervals,
      });
      results.push(skippedResult);
      continue;
    }

    const startedAtDate = new Date();
    const startedAt = startedAtDate.getTime();
    const completedAt = now.toISOString();
    const runId = `${config.id}:${startedAtDate.toISOString()}`;

    try {
      const adapter = createSourceAdapter(config);
      const releases = await adapter.collect();
      const existingReleaseIds = db.getExistingReleaseIds(releases.map((release) => release.id));
      const newReleases = releases.filter((release) => !existingReleaseIds.has(release.id));
      const diff = buildDiffSummary(
        newReleases.map((release) => release.title),
        newReleases,
      );

      if (persistResults) {
        for (const release of releases) {
          db.upsertRelease(release);
        }
      }

      const durationMs = Date.now() - startedAt;
      if (persistResults) {
        db.recordSourceRun({
          sourceId: config.id,
          lastRunAt: completedAt,
          lastSuccessAt: completedAt,
          lastErrorAt: null,
          lastErrorMessage: null,
          lastStatus: "success",
          lastRunDurationMs: durationMs,
        });
      }

      const historyEntry: SourceRunHistoryEntry = {
        runId,
        sourceId: config.id,
        sourceName: config.name,
        trigger,
        status: "success",
        startedAt: startedAtDate.toISOString(),
        completedAt,
        durationMs,
        releasesCollected: releases.length,
        newReleaseCount: newReleases.length,
        newReleaseTitles: newReleases.map((release) => release.title),
        diff,
        errorMessage: null,
        persisted: persistResults,
        respectedIntervals: respectIntervals,
      };
      db.recordSourceRunHistory(historyEntry);

      results.push({
        sourceId: config.id,
        sourceName: config.name,
        releasesCollected: releases.length,
        newReleaseCount: newReleases.length,
        newReleaseTitles: newReleases.map((release) => release.title),
        diff,
        status: "success",
        lastRunAt: completedAt,
        lastSuccessAt: completedAt,
        lastErrorAt: null,
        lastErrorMessage: null,
        durationMs,
        nextDueAt: getNextDueAt(config, completedAt, now),
        skipped: false,
        reason: null,
        persisted: persistResults,
        trigger,
      });
    } catch (error: unknown) {
      const durationMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : "Unknown error";
      if (persistResults) {
        db.recordSourceRun({
          sourceId: config.id,
          lastRunAt: completedAt,
          lastSuccessAt: runInfo.lastSuccessAt,
          lastErrorAt: completedAt,
          lastErrorMessage: message,
          lastStatus: "error",
          lastRunDurationMs: durationMs,
        });
      }

      db.recordSourceRunHistory({
        runId,
        sourceId: config.id,
        sourceName: config.name,
        trigger,
        status: "error",
        startedAt: startedAtDate.toISOString(),
        completedAt,
        durationMs,
        releasesCollected: 0,
        newReleaseCount: 0,
        newReleaseTitles: [],
        diff: { newReleases: [] },
        errorMessage: message,
        persisted: persistResults,
        respectedIntervals: respectIntervals,
      });

      results.push({
        sourceId: config.id,
        sourceName: config.name,
        releasesCollected: 0,
        newReleaseCount: 0,
        newReleaseTitles: [],
        diff: { newReleases: [] },
        status: "error",
        lastRunAt: completedAt,
        lastSuccessAt: runInfo.lastSuccessAt,
        lastErrorAt: completedAt,
        lastErrorMessage: message,
        durationMs,
        nextDueAt: getNextDueAt(config, completedAt, now),
        skipped: false,
        reason: message,
        persisted: persistResults,
        trigger,
      });
    }
  }

  return results;
}
