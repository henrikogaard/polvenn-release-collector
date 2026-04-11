import fs from "node:fs";
import path from "node:path";
import { load as loadXml } from "cheerio";
import { z } from "zod";
import type { ReleaseRecord } from "../types/releases.js";
import type {
  CollectorConfigFile,
  CollectorSettings,
  CsvImportSourceConfig,
  FileJsonSourceConfig,
  HttpJsonSourceConfig,
  ManualImportSourceConfig,
  OlbloggenVinmonopoletSourceConfig,
  RssFeedSourceConfig,
  ScheduleWindow,
  SourceAdapter,
  SourceConfig,
} from "../types/source.js";
import { fetchJson, fetchText } from "../utils/http.js";
import { OlbloggenVinmonopoletSourceAdapter } from "./olbloggen-vinmonopolet.js";

function parseOptionalPositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function parseOptionalInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return parsed;
}

function parseIntervalMinutes(input: Record<string, string>): number | undefined {
  const preset = input.schedulePreset?.trim() ?? "custom";
  switch (preset) {
    case "hourly":
      return 60;
    case "every_6_hours":
      return 360;
    case "daily":
      return 1440;
    case "weekly":
      return 10080;
    case "monthly":
      return 43200;
    default:
      return parseOptionalPositiveInteger(input.intervalMinutes);
  }
}

function parseScheduleWindow(input: Record<string, string>): ScheduleWindow | undefined {
  const mode = input.scheduleWindowMode?.trim() ?? "always";
  switch (mode) {
    case "always":
      return undefined;
    case "monthly_window": {
      const startDay = parseOptionalInteger(input.scheduleStartDay);
      const endDay = parseOptionalInteger(input.scheduleEndDay);
      if (!startDay || !endDay || startDay < 1 || startDay > 31 || endDay < 1 || endDay > 31) {
        throw new Error("Monthly window requires valid start and end days between 1 and 31.");
      }

      return { mode: "monthly_window", startDay, endDay };
    }
    case "date_range": {
      const startDate = input.scheduleStartDate?.trim() ?? "";
      const endDate = input.scheduleEndDate?.trim() ?? "";
      if (!startDate || !endDate) {
        throw new Error("Date range schedule requires both start and end dates.");
      }

      return { mode: "date_range", startDate, endDate };
    }
    default:
      throw new Error(`Unsupported schedule window mode: ${mode}`);
  }
}

function resolveEnvReference(value: unknown): unknown {
  if (typeof value === "string" && value.startsWith("env:")) {
    const envVarName = value.slice(4).trim();
    return process.env[envVarName] ?? "";
  }

  if (Array.isArray(value)) {
    return value.map(resolveEnvReference);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, resolveEnvReference(nestedValue)]),
    );
  }

  return value;
}

const ReleaseItemSchema = z.object({
  country: z.string().nullable().optional(),
  articleNumber: z.string().min(1),
  producer: z.string().min(1),
  name: z.string().min(1),
  style: z.string().optional().default(""),
  abv: z.number().optional().default(0),
  releaseDate: z.string().optional().default(""),
});

const ReleaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  source: z.string().min(1),
  publishedAt: z.string().min(1),
  url: z.string().url().nullable().optional(),
  items: z.array(ReleaseItemSchema),
}).transform((release): ReleaseRecord => ({
  id: release.id,
  title: release.title,
  source: release.source,
  publishedAt: release.publishedAt,
  url: release.url ?? null,
  items: release.items.map((item) => ({
    articleNumber: item.articleNumber,
    producer: item.producer,
    name: item.name,
    style: item.style,
    abv: item.abv,
    releaseDate: item.releaseDate,
    country: item.country ?? null,
  })),
}));

const ReleaseListSchema = z.object({
  releases: z.array(ReleaseSchema),
});

const ReleaseArraySchema = z.array(ReleaseSchema);

const ScheduleWindowSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("always") }),
  z.object({
    mode: z.literal("monthly_window"),
    startDay: z.number().int().min(1).max(31),
    endDay: z.number().int().min(1).max(31),
  }),
  z.object({
    mode: z.literal("date_range"),
    startDate: z.string().min(1),
    endDate: z.string().min(1),
  }),
]);

const BaseSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().optional().default(true),
  intervalMinutes: z.number().int().positive().optional(),
  scheduleWindow: ScheduleWindowSchema.optional(),
});

const FileJsonSourceSchema = BaseSourceSchema.extend({
  type: z.literal("file_json"),
  path: z.string().min(1),
});

const HttpJsonSourceSchema = BaseSourceSchema.extend({
  type: z.literal("http_json"),
  url: z.string().url(),
});

const RssFeedSourceSchema = BaseSourceSchema.extend({
  type: z.literal("rss_feed"),
  url: z.string().url(),
  maxItems: z.number().int().positive().optional().default(20),
});

const CsvImportSourceSchema = BaseSourceSchema.extend({
  type: z.literal("csv_import"),
  path: z.string().min(1).optional(),
  url: z.string().url().optional(),
  delimiter: z.string().min(1).optional().default(","),
  releaseId: z.string().min(1),
  releaseTitle: z.string().min(1),
  publishedAt: z.string().min(1),
  articleNumberColumn: z.string().min(1).optional().default("articleNumber"),
  producerColumn: z.string().min(1).optional().default("producer"),
  nameColumn: z.string().min(1).optional().default("name"),
  styleColumn: z.string().min(1).optional().default("style"),
  abvColumn: z.string().min(1).optional().default("abv"),
  countryColumn: z.string().min(1).optional().default("country"),
  releaseDateColumn: z.string().min(1).optional().default("releaseDate"),
});

const ManualImportSourceSchema = BaseSourceSchema.extend({
  type: z.literal("manual_import"),
  releases: z.array(ReleaseSchema).min(1),
});

const OlbloggenSourceSchema = BaseSourceSchema.extend({
  type: z.literal("olbloggen_vinmonopolet"),
  listingUrl: z.string().url(),
  maxPages: z.number().int().positive().optional().default(1),
  maxArticles: z.number().int().positive().optional().default(12),
  titlePrefix: z.string().min(1).optional().default("Ølnyheter på Vinmonopolet"),
});

export const SourceConfigSchema = z.union([
  FileJsonSourceSchema,
  HttpJsonSourceSchema,
  RssFeedSourceSchema,
  CsvImportSourceSchema,
  ManualImportSourceSchema,
  OlbloggenSourceSchema,
]);

const CollectorSettingsSchema = z.object({
  webhook: z.object({
    enabled: z.boolean().optional().default(false),
    url: z.string().url().nullable().optional(),
    format: z.enum(["generic", "slack", "discord"]).optional().default("generic"),
  }).optional(),
});

export const SourcesFileSchema = z.object({
  settings: CollectorSettingsSchema.optional().default({}),
  sources: z.array(SourceConfigSchema),
});

function validateSourceConfig(config: SourceConfig): SourceConfig {
  if (config.type === "csv_import" && !config.path && !config.url) {
    throw new Error("CSV import requires either a local path or a URL.");
  }

  return config;
}

function parseReleasePayload(payload: unknown): ReleaseRecord[] {
  if (Array.isArray(payload)) {
    return ReleaseArraySchema.parse(payload);
  }

  return ReleaseListSchema.parse(payload).releases;
}

function parseManualPayload(raw: string): ReleaseRecord[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Manual import requires release JSON.");
  }

  return parseReleasePayload(JSON.parse(trimmed));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    || "item";
}

function stripCdata(value: string): string {
  return value
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .trim();
}

function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === "\"") {
      if (inQuotes && nextChar === "\"") {
        currentField += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      currentRow.push(currentField);
      currentField = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }

      currentRow.push(currentField);
      if (currentRow.some((field) => field.trim() !== "")) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = "";
      continue;
    }

    currentField += char;
  }

  currentRow.push(currentField);
  if (currentRow.some((field) => field.trim() !== "")) {
    rows.push(currentRow);
  }

  return rows;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

function getColumnValue(record: Record<string, string>, name: string | undefined): string {
  if (!name) {
    return "";
  }

  const direct = record[name];
  if (direct != null) {
    return direct;
  }

  return record[normalizeHeader(name)] ?? "";
}

function getManualPayloadValue(releases: ReleaseRecord[]): string {
  return JSON.stringify({ releases }, null, 2);
}

export function getScheduleWindowSummary(window: ScheduleWindow | undefined): string {
  if (!window || window.mode === "always") {
    return "Any time";
  }

  if (window.mode === "monthly_window") {
    return `Days ${window.startDay}-${window.endDay} each month`;
  }

  return `${window.startDate} to ${window.endDate}`;
}

class FileJsonSourceAdapter implements SourceAdapter {
  constructor(private readonly config: FileJsonSourceConfig) {}

  async collect(): Promise<ReleaseRecord[]> {
    const filePath = path.resolve(this.config.path);
    const raw = fs.readFileSync(filePath, "utf8");
    return parseReleasePayload(JSON.parse(raw));
  }
}

class HttpJsonSourceAdapter implements SourceAdapter {
  constructor(private readonly config: HttpJsonSourceConfig) {}

  async collect(): Promise<ReleaseRecord[]> {
    const payload = await fetchJson<unknown>(this.config.url);
    return parseReleasePayload(payload);
  }
}

class RssFeedSourceAdapter implements SourceAdapter {
  constructor(private readonly config: RssFeedSourceConfig) {}

  async collect(): Promise<ReleaseRecord[]> {
    const xml = await fetchText(this.config.url);
    const $ = loadXml(xml, { xmlMode: true });
    const entries = $("item").toArray();
    const feedItems = entries.length > 0 ? entries : $("entry").toArray();

    return feedItems
      .slice(0, this.config.maxItems ?? 20)
      .map((entry, index): ReleaseRecord => {
        const node = $(entry);
        const title = stripCdata(
          node.find("title").first().text()
            || node.children("title").first().text()
            || `Feed entry ${index + 1}`,
        );
        const link = stripCdata(
          node.find("link").attr("href")
            || node.find("link").first().text()
            || node.children("link").attr("href")
            || node.children("link").first().text()
            || "",
        );
        const guid = stripCdata(
          node.find("guid").first().text()
            || node.find("id").first().text()
            || link
            || title,
        );
        const publishedAt = stripCdata(
          node.find("pubDate").first().text()
            || node.find("published").first().text()
            || node.find("updated").first().text()
            || new Date().toISOString(),
        );

        return {
          id: `${this.config.id}:${slugify(guid)}`,
          title,
          source: this.config.name,
          publishedAt: new Date(publishedAt).toString() === "Invalid Date"
            ? new Date().toISOString()
            : new Date(publishedAt).toISOString(),
          url: link || null,
          items: [],
        };
      });
  }
}

class CsvImportSourceAdapter implements SourceAdapter {
  constructor(private readonly config: CsvImportSourceConfig) {}

  async collect(): Promise<ReleaseRecord[]> {
    const raw = this.config.url
      ? await fetchText(this.config.url)
      : fs.readFileSync(path.resolve(this.config.path ?? ""), "utf8");
    const rows = parseCsv(raw, this.config.delimiter ?? ",");
    if (rows.length < 1) {
      return [];
    }

    const headers = rows[0]?.map((header) => header.trim()) ?? [];
    const normalizedHeaders = headers.map(normalizeHeader);
    const items = rows.slice(1)
      .map((row) => {
        const record = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
        for (const [index, normalizedHeader] of normalizedHeaders.entries()) {
          record[normalizedHeader] = row[index] ?? "";
        }

        const name = getColumnValue(record, this.config.nameColumn ?? "name");
        const producer = getColumnValue(record, this.config.producerColumn ?? "producer");
        const articleNumber = getColumnValue(record, this.config.articleNumberColumn ?? "articleNumber");
        if (!name || !producer || !articleNumber) {
          return null;
        }

        const abvRaw = getColumnValue(record, this.config.abvColumn ?? "abv").replace(",", ".");
        const parsedAbv = Number.parseFloat(abvRaw);

        return {
          articleNumber,
          producer,
          name,
          style: getColumnValue(record, this.config.styleColumn ?? "style"),
          abv: Number.isFinite(parsedAbv) ? parsedAbv : 0,
          country: getColumnValue(record, this.config.countryColumn ?? "country") || null,
          releaseDate: getColumnValue(record, this.config.releaseDateColumn ?? "releaseDate"),
        };
      })
      .filter((item): item is ReleaseRecord["items"][number] => item !== null);

    return [{
      id: this.config.releaseId,
      title: this.config.releaseTitle,
      source: this.config.name,
      publishedAt: this.config.publishedAt,
      url: this.config.url ?? null,
      items,
    }];
  }
}

class ManualImportSourceAdapter implements SourceAdapter {
  constructor(private readonly config: ManualImportSourceConfig) {}

  async collect(): Promise<ReleaseRecord[]> {
    return this.config.releases;
  }
}

export function loadCollectorConfig(configPath: string): CollectorConfigFile {
  if (!fs.existsSync(configPath)) {
    return { settings: {}, sources: [] };
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = SourcesFileSchema.parse(resolveEnvReference(JSON.parse(raw)));
  return {
    settings: (parsed.settings ?? {}) as CollectorSettings,
    sources: parsed.sources.map((source) => validateSourceConfig(source as SourceConfig)),
  };
}

export function loadCollectorSettings(configPath: string): CollectorSettings {
  return loadCollectorConfig(configPath).settings ?? {};
}

export function loadSourceConfigs(configPath: string): SourceConfig[] {
  return loadCollectorConfig(configPath).sources;
}

export function saveCollectorConfig(configPath: string, config: CollectorConfigFile): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const payload = SourcesFileSchema.parse({
    settings: config.settings ?? {},
    sources: config.sources.map((source) => validateSourceConfig(source)),
  });
  fs.writeFileSync(configPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function saveCollectorSettings(configPath: string, settings: CollectorSettings): CollectorSettings {
  const current = loadCollectorConfig(configPath);
  saveCollectorConfig(configPath, {
    settings,
    sources: current.sources,
  });
  return settings;
}

export function saveSourceConfigs(configPath: string, sources: SourceConfig[]): void {
  const current = loadCollectorConfig(configPath);
  saveCollectorConfig(configPath, {
    settings: current.settings ?? {},
    sources,
  });
}

export function upsertSourceConfig(configPath: string, sourceConfig: SourceConfig): SourceConfig[] {
  const current = loadCollectorConfig(configPath);
  const withoutCurrent = current.sources.filter((source) => source.id !== sourceConfig.id);
  const updated = [...withoutCurrent, sourceConfig].sort((left, right) => left.id.localeCompare(right.id));
  saveCollectorConfig(configPath, {
    settings: current.settings ?? {},
    sources: updated,
  });
  return updated;
}

export function removeSourceConfig(configPath: string, sourceId: string): SourceConfig[] {
  const current = loadCollectorConfig(configPath);
  const updated = current.sources.filter((source) => source.id !== sourceId);
  saveCollectorConfig(configPath, {
    settings: current.settings ?? {},
    sources: updated,
  });
  return updated;
}

export function parseSettingsForm(input: Record<string, string>): CollectorSettings {
  const enabled = input.webhookEnabled === "true" || input.webhookEnabled === "on";
  const url = input.webhookUrl?.trim() || null;
  const format = input.webhookFormat?.trim() || "generic";

  return CollectorSettingsSchema.parse({
    webhook: {
      enabled,
      url,
      format,
    },
  });
}

export function parseSourceConfigForm(input: Record<string, string>): SourceConfig {
  const common = {
    id: input.id?.trim() ?? "",
    name: input.name?.trim() ?? "",
    type: input.type?.trim(),
    enabled: input.enabled === "true" || input.enabled === "on",
    intervalMinutes: parseIntervalMinutes(input),
    scheduleWindow: parseScheduleWindow(input),
  };

  switch (common.type) {
    case "file_json":
      return validateSourceConfig(SourceConfigSchema.parse({
        ...common,
        type: "file_json",
        path: input.path?.trim() ?? "",
      }));
    case "http_json":
      return validateSourceConfig(SourceConfigSchema.parse({
        ...common,
        type: "http_json",
        url: input.url?.trim() ?? "",
      }));
    case "rss_feed":
      return validateSourceConfig(SourceConfigSchema.parse({
        ...common,
        type: "rss_feed",
        url: input.url?.trim() ?? "",
        maxItems: parseOptionalPositiveInteger(input.maxItems),
      }));
    case "csv_import":
      return validateSourceConfig(SourceConfigSchema.parse({
        ...common,
        type: "csv_import",
        path: input.path?.trim() || undefined,
        url: input.url?.trim() || undefined,
        delimiter: input.delimiter?.trim() || ",",
        releaseId: input.releaseId?.trim() ?? "",
        releaseTitle: input.releaseTitle?.trim() ?? "",
        publishedAt: input.publishedAt?.trim() ?? "",
        articleNumberColumn: input.articleNumberColumn?.trim() || undefined,
        producerColumn: input.producerColumn?.trim() || undefined,
        nameColumn: input.nameColumn?.trim() || undefined,
        styleColumn: input.styleColumn?.trim() || undefined,
        abvColumn: input.abvColumn?.trim() || undefined,
        countryColumn: input.countryColumn?.trim() || undefined,
        releaseDateColumn: input.releaseDateColumn?.trim() || undefined,
      }));
    case "manual_import":
      return validateSourceConfig(SourceConfigSchema.parse({
        ...common,
        type: "manual_import",
        releases: parseManualPayload(input.manualPayload ?? ""),
      }));
    case "olbloggen_vinmonopolet":
      return validateSourceConfig(SourceConfigSchema.parse({
        ...common,
        type: "olbloggen_vinmonopolet",
        listingUrl: input.listingUrl?.trim() ?? "",
        maxPages: parseOptionalPositiveInteger(input.maxPages),
        maxArticles: parseOptionalPositiveInteger(input.maxArticles),
        titlePrefix: input.titlePrefix?.trim() || undefined,
      }));
    default:
      throw new Error(`Unsupported source type: ${common.type ?? "unknown"}`);
  }
}

export function serializeSourceConfigForForm(config: SourceConfig): Record<string, string> {
  const base = {
    id: config.id,
    name: config.name,
    enabled: config.enabled !== false ? "true" : "false",
    intervalMinutes: config.intervalMinutes ? String(config.intervalMinutes) : "",
  };

  const scheduleFields = (() => {
    if (!config.scheduleWindow || config.scheduleWindow.mode === "always") {
      return {
        scheduleWindowMode: "always",
        scheduleStartDay: "",
        scheduleEndDay: "",
        scheduleStartDate: "",
        scheduleEndDate: "",
      };
    }

    if (config.scheduleWindow.mode === "monthly_window") {
      return {
        scheduleWindowMode: "monthly_window",
        scheduleStartDay: String(config.scheduleWindow.startDay),
        scheduleEndDay: String(config.scheduleWindow.endDay),
        scheduleStartDate: "",
        scheduleEndDate: "",
      };
    }

    return {
      scheduleWindowMode: "date_range",
      scheduleStartDay: "",
      scheduleEndDay: "",
      scheduleStartDate: config.scheduleWindow.startDate,
      scheduleEndDate: config.scheduleWindow.endDate,
    };
  })();

  switch (config.type) {
    case "file_json":
      return { ...base, ...scheduleFields, type: config.type, path: config.path };
    case "http_json":
      return { ...base, ...scheduleFields, type: config.type, url: config.url };
    case "rss_feed":
      return {
        ...base,
        ...scheduleFields,
        type: config.type,
        url: config.url,
        maxItems: String(config.maxItems ?? 20),
      };
    case "csv_import":
      return {
        ...base,
        ...scheduleFields,
        type: config.type,
        path: config.path ?? "",
        url: config.url ?? "",
        delimiter: config.delimiter ?? ",",
        releaseId: config.releaseId,
        releaseTitle: config.releaseTitle,
        publishedAt: config.publishedAt,
        articleNumberColumn: config.articleNumberColumn ?? "articleNumber",
        producerColumn: config.producerColumn ?? "producer",
        nameColumn: config.nameColumn ?? "name",
        styleColumn: config.styleColumn ?? "style",
        abvColumn: config.abvColumn ?? "abv",
        countryColumn: config.countryColumn ?? "country",
        releaseDateColumn: config.releaseDateColumn ?? "releaseDate",
      };
    case "manual_import":
      return {
        ...base,
        ...scheduleFields,
        type: config.type,
        manualPayload: getManualPayloadValue(config.releases),
      };
    case "olbloggen_vinmonopolet":
      return {
        ...base,
        ...scheduleFields,
        type: config.type,
        listingUrl: config.listingUrl,
        maxPages: String(config.maxPages ?? 1),
        maxArticles: String(config.maxArticles ?? 12),
        titlePrefix: config.titlePrefix ?? "Ølnyheter på Vinmonopolet",
      };
  }
}

export function createSourceAdapter(config: SourceConfig): SourceAdapter {
  switch (config.type) {
    case "file_json":
      return new FileJsonSourceAdapter(config);
    case "http_json":
      return new HttpJsonSourceAdapter(config);
    case "rss_feed":
      return new RssFeedSourceAdapter(config);
    case "csv_import":
      return new CsvImportSourceAdapter(config);
    case "manual_import":
      return new ManualImportSourceAdapter(config);
    case "olbloggen_vinmonopolet":
      return new OlbloggenVinmonopoletSourceAdapter(config as OlbloggenVinmonopoletSourceConfig);
  }

  throw new Error(`Unsupported source type: ${(config as SourceConfig).type}`);
}
