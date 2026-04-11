export interface ReleaseItem {
  country: string | null;
  articleNumber: string;
  producer: string;
  name: string;
  style: string;
  abv: number;
  releaseDate: string;
}

export interface ReleaseRecord {
  id: string;
  title: string;
  source: string;
  publishedAt: string;
  url: string | null;
  items: ReleaseItem[];
}

export interface ReleaseDiffEntry {
  releaseId: string;
  title: string;
  publishedAt: string;
  url: string | null;
  itemCount: number;
  itemNames: string[];
}

export interface ReleaseDiffSummary {
  newReleases: ReleaseDiffEntry[];
}

export interface SourceRunResult {
  sourceId: string;
  sourceName: string;
  releasesCollected: number;
  newReleaseCount: number;
  newReleaseTitles: string[];
  diff: ReleaseDiffSummary;
  status: "success" | "error" | "skipped";
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  durationMs: number | null;
  nextDueAt: string | null;
  skipped: boolean;
  reason: string | null;
  persisted: boolean;
  trigger: "startup" | "scheduled" | "manual" | "test";
}

export interface SourceStatus {
  sourceId: string;
  sourceName: string;
  sourceType: string;
  enabled: boolean;
  intervalMinutes: number | null;
  scheduleSummary: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  lastStatus: "success" | "error" | null;
  lastRunDurationMs: number | null;
  nextDueAt: string | null;
  isDue: boolean;
}

export interface StoredSourceRunInfo {
  sourceId: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  lastStatus: "success" | "error" | null;
  lastRunDurationMs: number | null;
}

export interface SourceRunHistoryEntry {
  runId: string;
  sourceId: string;
  sourceName: string;
  trigger: "startup" | "scheduled" | "manual" | "test";
  status: "success" | "error" | "skipped";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  releasesCollected: number;
  newReleaseCount: number;
  newReleaseTitles: string[];
  diff: ReleaseDiffSummary;
  errorMessage: string | null;
  persisted: boolean;
  respectedIntervals: boolean;
}
