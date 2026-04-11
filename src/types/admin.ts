import type {
  ReleaseRecord,
  SourceRunHistoryEntry,
  StoredSourceRunInfo,
} from "./releases.js";
import type { CollectorSettings, SourceConfig } from "./source.js";

export interface CollectorExportBundle {
  exportedAt: string;
  service: string;
  host: string | null;
  settings: CollectorSettings;
  sources: SourceConfig[];
  sourceRuns: StoredSourceRunInfo[];
  recentRuns: SourceRunHistoryEntry[];
  latestReleases: ReleaseRecord[];
}

export type ImportPreviewType = "config" | "bundle" | "database";

export interface RestoreSelection {
  applySettings: boolean;
  applySources: boolean;
  applyReleases: boolean;
  applySourceRuns: boolean;
  applyRunHistory: boolean;
}

export interface ImportPreviewSummary {
  id: string;
  type: ImportPreviewType;
  createdAt: string;
  title: string;
  details: string[];
  changes: string[];
  defaultSelection: RestoreSelection;
  warning: string | null;
}
