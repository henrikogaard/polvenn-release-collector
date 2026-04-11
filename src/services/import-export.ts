import { z } from "zod";
import { SourcesFileSchema } from "../sources/index.js";
import type { ImportPreviewSummary, RestoreSelection } from "../types/admin.js";
import type { CollectorConfigFile } from "../types/source.js";
import type { CollectorExportBundle } from "../types/admin.js";
import type { CollectorSettings, SourceConfig } from "../types/source.js";

const ReleaseDiffEntrySchema = z.object({
  releaseId: z.string().min(1),
  title: z.string().min(1),
  publishedAt: z.string().min(1),
  url: z.string().url().nullable(),
  itemCount: z.number().int().min(0),
  itemNames: z.array(z.string()),
});

const ReleaseDiffSummarySchema = z.object({
  newReleases: z.array(ReleaseDiffEntrySchema),
});

const ReleaseItemSchema = z.object({
  country: z.string().nullable(),
  articleNumber: z.string().min(1),
  producer: z.string().min(1),
  name: z.string().min(1),
  style: z.string(),
  abv: z.number(),
  releaseDate: z.string(),
});

const ReleaseRecordSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  source: z.string().min(1),
  publishedAt: z.string().min(1),
  url: z.string().url().nullable(),
  items: z.array(ReleaseItemSchema),
});

const StoredSourceRunInfoSchema = z.object({
  sourceId: z.string().min(1),
  lastRunAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastErrorAt: z.string().nullable(),
  lastErrorMessage: z.string().nullable(),
  lastStatus: z.union([z.literal("success"), z.literal("error"), z.null()]),
  lastRunDurationMs: z.number().int().nullable(),
});

const SourceRunHistoryEntrySchema = z.object({
  runId: z.string().min(1),
  sourceId: z.string().min(1),
  sourceName: z.string().min(1),
  trigger: z.union([
    z.literal("startup"),
    z.literal("scheduled"),
    z.literal("manual"),
    z.literal("test"),
  ]),
  status: z.union([z.literal("success"), z.literal("error"), z.literal("skipped")]),
  startedAt: z.string().min(1),
  completedAt: z.string().min(1),
  durationMs: z.number().int().min(0),
  releasesCollected: z.number().int().min(0),
  newReleaseCount: z.number().int().min(0),
  newReleaseTitles: z.array(z.string()),
  diff: ReleaseDiffSummarySchema,
  errorMessage: z.string().nullable(),
  persisted: z.boolean(),
  respectedIntervals: z.boolean(),
});

const CollectorExportBundleSchema = z.object({
  exportedAt: z.string().min(1),
  service: z.string().min(1),
  host: z.string().nullable(),
  settings: SourcesFileSchema.shape.settings.default({}),
  sources: SourcesFileSchema.shape.sources,
  sourceRuns: z.array(StoredSourceRunInfoSchema).optional().default([]),
  recentRuns: z.array(SourceRunHistoryEntrySchema),
  latestReleases: z.array(ReleaseRecordSchema),
});

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Import payload is empty.");
  }

  return JSON.parse(trimmed);
}

export function parseCollectorConfigImport(raw: string): CollectorConfigFile {
  return SourcesFileSchema.parse(parseJsonObject(raw));
}

export function parseCollectorExportBundle(raw: string): CollectorExportBundle {
  return CollectorExportBundleSchema.parse(parseJsonObject(raw));
}

export function decodeBase64FilePayload(raw: string): Buffer {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Import payload is empty.");
  }

  const base64 = trimmed.startsWith("data:")
    ? trimmed.slice(trimmed.indexOf(",") + 1)
    : trimmed;

  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0) {
    throw new Error("Could not decode uploaded file payload.");
  }

  return buffer;
}

function summarizeSourceTypes(sources: CollectorConfigFile["sources"]): string {
  const counts = new Map<string, number>();
  for (const source of sources) {
    counts.set(source.type, (counts.get(source.type) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([type, count]) => `${count} ${type}`)
    .join(", ");
}

function sourceFingerprint(source: SourceConfig): string {
  return JSON.stringify(source);
}

function summarizeWebhook(settings: CollectorSettings | undefined): string {
  if (settings?.webhook?.enabled) {
    return `enabled (${settings.webhook.format ?? "generic"})`;
  }

  return "disabled";
}

function describeSourceConfigChanges(currentSources: SourceConfig[], nextSources: SourceConfig[]): string[] {
  const currentById = new Map(currentSources.map((source) => [source.id, source]));
  const nextById = new Map(nextSources.map((source) => [source.id, source]));

  const added = nextSources
    .filter((source) => !currentById.has(source.id))
    .map((source) => source.id);
  const removed = currentSources
    .filter((source) => !nextById.has(source.id))
    .map((source) => source.id);
  const updated = nextSources
    .filter((source) => {
      const current = currentById.get(source.id);
      return current && sourceFingerprint(current) !== sourceFingerprint(source);
    })
    .map((source) => source.id);

  const changes: string[] = [];
  if (added.length > 0) {
    changes.push(`Adds ${added.length} source(s): ${added.join(", ")}`);
  }
  if (removed.length > 0) {
    changes.push(`Removes ${removed.length} source(s): ${removed.join(", ")}`);
  }
  if (updated.length > 0) {
    changes.push(`Updates ${updated.length} existing source(s): ${updated.join(", ")}`);
  }
  if (changes.length === 0) {
    changes.push("No source definition changes detected.");
  }

  return changes;
}

function formatDelta(label: string, currentValue: number, nextValue: number): string {
  const delta = nextValue - currentValue;
  const sign = delta > 0 ? "+" : "";
  return `${label}: ${currentValue} -> ${nextValue} (${sign}${delta})`;
}

export function buildConfigPreviewSummary(params: {
  id: string;
  currentConfig: CollectorConfigFile;
  importedConfig: CollectorConfigFile;
}): ImportPreviewSummary {
  const { id, currentConfig, importedConfig } = params;
  return {
    id,
    type: "config",
    createdAt: new Date().toISOString(),
    title: "Config import preview",
    details: [
      `${importedConfig.sources.length} source definition(s) in import`,
      importedConfig.sources.length > 0 ? summarizeSourceTypes(importedConfig.sources) : "No sources in payload",
      `Webhook: ${summarizeWebhook(currentConfig.settings)} -> ${summarizeWebhook(importedConfig.settings)}`,
    ],
    changes: describeSourceConfigChanges(currentConfig.sources, importedConfig.sources),
    defaultSelection: {
      applySettings: true,
      applySources: true,
      applyReleases: false,
      applySourceRuns: false,
      applyRunHistory: false,
    },
    warning: "Applying this will replace current settings and source definitions, but keep stored releases and run history.",
  };
}

export function buildBundlePreviewSummary(params: {
  id: string;
  currentConfig: CollectorConfigFile;
  currentStats: { releaseCount: number; sourceRunCount: number; runHistoryCount: number };
  importedBundle: CollectorExportBundle;
}): ImportPreviewSummary {
  const { id, currentConfig, currentStats, importedBundle } = params;
  return {
    id,
    type: "bundle",
    createdAt: new Date().toISOString(),
    title: "Bundle restore preview",
    details: [
      `${importedBundle.sources.length} source definition(s) in bundle`,
      formatDelta("Releases", currentStats.releaseCount, importedBundle.latestReleases.length),
      formatDelta("Source run snapshots", currentStats.sourceRunCount, importedBundle.sourceRuns.length),
      formatDelta("Run history entries", currentStats.runHistoryCount, importedBundle.recentRuns.length),
    ],
    changes: [
      ...describeSourceConfigChanges(currentConfig.sources, importedBundle.sources),
      `Webhook: ${summarizeWebhook(currentConfig.settings)} -> ${summarizeWebhook(importedBundle.settings)}`,
    ],
    defaultSelection: {
      applySettings: true,
      applySources: true,
      applyReleases: true,
      applySourceRuns: true,
      applyRunHistory: true,
    },
    warning: "Applying this will replace current settings, sources, releases and run history with the bundle contents.",
  };
}

export function buildDatabasePreviewSummary(params: {
  id: string;
  sizeBytes: number;
  currentReleaseCount: number;
  currentSourceRunCount: number;
  currentRunHistoryCount: number;
  releaseCount: number;
  sourceRunCount: number;
  runHistoryCount: number;
}): ImportPreviewSummary {
  return {
    id: params.id,
    type: "database",
    createdAt: new Date().toISOString(),
    title: "Database restore preview",
    details: [
      `${params.sizeBytes} byte(s)`,
      formatDelta("Releases", params.currentReleaseCount, params.releaseCount),
      formatDelta("Source run snapshots", params.currentSourceRunCount, params.sourceRunCount),
      formatDelta("Run history entries", params.currentRunHistoryCount, params.runHistoryCount),
    ],
    changes: [
      "Collector config file stays unchanged.",
      "SQLite database file will be replaced with the uploaded database.",
    ],
    defaultSelection: {
      applySettings: false,
      applySources: false,
      applyReleases: true,
      applySourceRuns: true,
      applyRunHistory: true,
    },
    warning: "Applying this will replace the current SQLite database file, but keep the current collector config file.",
  };
}

export function parseRestoreSelection(input: Record<string, string>): RestoreSelection {
  const enabled = (name: keyof RestoreSelection): boolean => {
    const value = input[name];
    return value === "true" || value === "on" || value === "1" || value === "yes";
  };

  return {
    applySettings: enabled("applySettings"),
    applySources: enabled("applySources"),
    applyReleases: enabled("applyReleases"),
    applySourceRuns: enabled("applySourceRuns"),
    applyRunHistory: enabled("applyRunHistory"),
  };
}
