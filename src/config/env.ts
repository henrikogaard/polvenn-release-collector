import os from "node:os";
import path from "node:path";

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null) {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseInteger(value: string | undefined, defaultValue: number): number {
  if (value == null) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseOptionalString(value: string | undefined): string | null {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

const dataDir = process.env.POLVENN_COLLECTOR_DATA_DIR
  ?? path.join(os.homedir(), ".polvenn-release-collector");

export const env = {
  port: parseInteger(process.env.POLVENN_COLLECTOR_PORT, 4100),
  dataDir,
  dbPath: process.env.POLVENN_COLLECTOR_DB_PATH ?? path.join(dataDir, "collector.db"),
  sourcesPath: process.env.POLVENN_COLLECTOR_SOURCES_PATH ?? path.join(process.cwd(), "polvenn-release-collector.config.json"),
  runOnStart: parseBoolean(process.env.POLVENN_COLLECTOR_RUN_ON_START, true),
  schedulerIntervalMinutes: parseInteger(process.env.POLVENN_COLLECTOR_INTERVAL_MINUTES, 0),
  adminToken: parseOptionalString(process.env.POLVENN_COLLECTOR_ADMIN_TOKEN),
  publicStatusPage: parseBoolean(process.env.POLVENN_COLLECTOR_PUBLIC_STATUS_PAGE, true),
  secureCookies: parseBoolean(process.env.POLVENN_COLLECTOR_SECURE_COOKIES, false),
  webhookUrl: parseOptionalString(process.env.POLVENN_COLLECTOR_WEBHOOK_URL),
  webhookFormat: parseOptionalString(process.env.POLVENN_COLLECTOR_WEBHOOK_FORMAT) ?? "generic",
};
