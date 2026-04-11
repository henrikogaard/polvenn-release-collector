import type { ReleaseRecord } from "./releases.js";

export type ScheduleWindow =
  | { mode: "always" }
  | { mode: "monthly_window"; startDay: number; endDay: number }
  | { mode: "date_range"; startDate: string; endDate: string };

interface SourceConfigBase {
  id: string;
  name: string;
  enabled?: boolean;
  intervalMinutes?: number;
  scheduleWindow?: ScheduleWindow;
}

export interface FileJsonSourceConfig extends SourceConfigBase {
  name: string;
  type: "file_json";
  path: string;
}

export interface HttpJsonSourceConfig extends SourceConfigBase {
  type: "http_json";
  url: string;
}

export interface RssFeedSourceConfig extends SourceConfigBase {
  type: "rss_feed";
  url: string;
  maxItems?: number;
}

export interface CsvImportSourceConfig extends SourceConfigBase {
  type: "csv_import";
  path?: string;
  url?: string;
  delimiter?: string;
  releaseId: string;
  releaseTitle: string;
  publishedAt: string;
  articleNumberColumn?: string;
  producerColumn?: string;
  nameColumn?: string;
  styleColumn?: string;
  abvColumn?: string;
  countryColumn?: string;
  releaseDateColumn?: string;
}

export interface ManualImportSourceConfig extends SourceConfigBase {
  type: "manual_import";
  releases: ReleaseRecord[];
}

export interface OlbloggenVinmonopoletSourceConfig extends SourceConfigBase {
  type: "olbloggen_vinmonopolet";
  listingUrl: string;
  maxPages?: number;
  maxArticles?: number;
  titlePrefix?: string;
}

export interface CollectorWebhookSettings {
  enabled?: boolean;
  url?: string | null;
  format?: "generic" | "slack" | "discord";
}

export interface CollectorSettings {
  webhook?: CollectorWebhookSettings;
}

export interface CollectorConfigFile {
  settings?: CollectorSettings;
  sources: SourceConfig[];
}

export type SourceConfig =
  | FileJsonSourceConfig
  | HttpJsonSourceConfig
  | RssFeedSourceConfig
  | CsvImportSourceConfig
  | ManualImportSourceConfig
  | OlbloggenVinmonopoletSourceConfig;

export interface SourceAdapter {
  collect(): Promise<ReleaseRecord[]>;
}
