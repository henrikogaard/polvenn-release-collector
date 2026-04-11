import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { env } from "./config/env.js";
import { ReleaseDatabase } from "./db/database.js";
import {
  buildAdminLogoutCookie,
  buildAdminSessionCookie,
  isAuthorizedRequest,
} from "./http/auth.js";
import {
  renderAdminDashboardPage,
  renderAdminLoginPage,
} from "./http/admin-page.js";
import { renderStatusPage } from "./http/status-page.js";
import { collectSources, listSourceStatuses } from "./services/collector.js";
import { notifyWebhook } from "./services/webhooks.js";
import {
  loadCollectorConfig,
  loadCollectorSettings,
  parseSettingsForm,
  parseSourceConfigForm,
  removeSourceConfig,
  saveCollectorSettings,
  saveCollectorConfig,
  upsertSourceConfig,
} from "./sources/index.js";
import {
  buildBundlePreviewSummary,
  buildConfigPreviewSummary,
  buildDatabasePreviewSummary,
  decodeBase64FilePayload,
  parseCollectorConfigImport,
  parseCollectorExportBundle,
  parseRestoreSelection,
} from "./services/import-export.js";
import type {
  CollectorExportBundle,
  ImportPreviewSummary,
  ImportPreviewType,
  RestoreSelection,
} from "./types/admin.js";
import type { CollectorSettings } from "./types/source.js";

interface PendingImport {
  type: ImportPreviewType;
  preview: ImportPreviewSummary;
  config?: ReturnType<typeof parseCollectorConfigImport>;
  bundle?: CollectorExportBundle;
  databaseTempPath?: string;
}

function mergeCollectorConfig(
  currentConfig: ReturnType<typeof loadCollectorConfig>,
  selection: RestoreSelection,
  nextConfig?: { settings?: typeof currentConfig.settings; sources: typeof currentConfig.sources },
): ReturnType<typeof loadCollectorConfig> {
  return {
    settings: selection.applySettings ? (nextConfig?.settings ?? {}) : (currentConfig.settings ?? {}),
    sources: selection.applySources ? (nextConfig?.sources ?? []) : currentConfig.sources,
  };
}

function jsonResponse(statusCode: number, payload: unknown): { statusCode: number; body: string } {
  return {
    statusCode,
    body: JSON.stringify(payload, null, 2),
  };
}

function htmlResponse(statusCode: number, body: string): { statusCode: number; body: string } {
  return {
    statusCode,
    body,
  };
}

function redirectResponse(location: string): { statusCode: number; location: string } {
  return {
    statusCode: 303,
    location,
  };
}

function getRuntimeWebhookConfig(settings: CollectorSettings): {
  url: string | null;
  format: "generic" | "slack" | "discord";
} {
  if (env.webhookUrl) {
    return {
      url: env.webhookUrl,
      format: env.webhookFormat === "slack" || env.webhookFormat === "discord"
        ? env.webhookFormat
        : "generic",
    };
  }

  return {
    url: settings.webhook?.enabled ? settings.webhook.url ?? null : null,
    format: settings.webhook?.format ?? "generic",
  };
}

function createBackupSnapshot(): string {
  const backupRoot = path.join(env.dataDir, "backups");
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const snapshotDir = path.join(backupRoot, timestamp);

  fs.mkdirSync(snapshotDir, { recursive: true });

  if (fs.existsSync(env.sourcesPath)) {
    fs.copyFileSync(env.sourcesPath, path.join(snapshotDir, "collector-config.json"));
  }

  if (fs.existsSync(env.dbPath)) {
    fs.copyFileSync(env.dbPath, path.join(snapshotDir, "collector.db"));
  }

  fs.writeFileSync(
    path.join(snapshotDir, "manifest.json"),
    `${JSON.stringify({
      createdAt: new Date().toISOString(),
      sourcesPath: env.sourcesPath,
      dbPath: env.dbPath,
      host: "beer.ogard.cloud",
    }, null, 2)}\n`,
    "utf8",
  );

  return snapshotDir;
}

async function readFormBody(req: http.IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function renderAdminResponse(params: Parameters<typeof renderAdminDashboardPage>[0]): {
  statusCode: number;
  body: string;
} {
  return htmlResponse(200, renderAdminDashboardPage(params));
}

async function main(): Promise<void> {
  const db = new ReleaseDatabase(env.dbPath);
  await db.init();
  const pendingImports = new Map<string, PendingImport>();

  const cleanupPendingImport = (previewId: string) => {
    const pending = pendingImports.get(previewId);
    if (pending?.databaseTempPath && fs.existsSync(pending.databaseTempPath)) {
      fs.unlinkSync(pending.databaseTempPath);
    }
    pendingImports.delete(previewId);
  };

  const runCollection = async (
    sourceId?: string,
    respectIntervals = false,
    options: { persistResults?: boolean; trigger?: "startup" | "scheduled" | "manual" | "test" } = {},
  ) => {
    const results = await collectSources(db, env.sourcesPath, {
      sourceId,
      respectIntervals,
      persistResults: options.persistResults,
      trigger: options.trigger,
    });

    const webhookConfig = getRuntimeWebhookConfig(loadCollectorSettings(env.sourcesPath));
    await notifyWebhook(webhookConfig, results).catch((error: unknown) => {
      console.error("Webhook notification failed:", error);
    });
    return results;
  };

  if (env.runOnStart) {
    try {
      const results = await runCollection(undefined, true, { trigger: "startup" });
      console.error(`Initial collection finished for ${results.length} source(s).`);
    } catch (error: unknown) {
      console.error("Initial collection failed:", error);
    }
  }

  if (env.schedulerIntervalMinutes > 0) {
    setInterval(() => {
      void runCollection(undefined, true, { trigger: "scheduled" }).catch((error: unknown) => {
        console.error("Scheduled collection failed:", error);
      });
    }, env.schedulerIntervalMinutes * 60_000);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${env.port}`);
      const collectorConfig = loadCollectorConfig(env.sourcesPath);
      const sourceConfigs = collectorConfig.sources;
      const collectorSettings = collectorConfig.settings ?? {};
      const sources = listSourceStatuses(db, env.sourcesPath);
      const runHistory = db.listSourceRunHistory(25);
      const adminAuthorized = isAuthorizedRequest(req, env.adminToken);

      if (method === "GET" && url.pathname === "/admin") {
        const response = adminAuthorized
          ? htmlResponse(200, renderAdminDashboardPage({
            serviceName: "Polvenn release collector",
            sourceConfigs,
            sourceStatuses: sources,
            collectorSettings,
            runHistory,
          }))
          : htmlResponse(200, renderAdminLoginPage({
            serviceName: "Polvenn release collector",
          }));

        res.writeHead(response.statusCode, { "Content-Type": "text/html; charset=utf-8" });
        res.end(response.body);
        return;
      }

      if (method === "POST" && url.pathname === "/admin/login") {
        const form = await readFormBody(req);
        const token = form.get("token")?.trim() ?? "";

        if (env.adminToken && token !== env.adminToken) {
          const response = htmlResponse(401, renderAdminLoginPage({
            serviceName: "Polvenn release collector",
            message: "Wrong admin token.",
          }));
          res.writeHead(response.statusCode, { "Content-Type": "text/html; charset=utf-8" });
          res.end(response.body);
          return;
        }

        const response = redirectResponse("/admin");
        res.writeHead(response.statusCode, {
          Location: response.location,
          "Set-Cookie": buildAdminSessionCookie(token, env.secureCookies),
        });
        res.end();
        return;
      }

      if (method === "POST" && url.pathname === "/admin/logout") {
        const response = redirectResponse("/admin");
        res.writeHead(response.statusCode, {
          Location: response.location,
          "Set-Cookie": buildAdminLogoutCookie(env.secureCookies),
        });
        res.end();
        return;
      }

      if (method === "POST" && url.pathname === "/admin/run") {
        if (!adminAuthorized) {
          const response = redirectResponse("/admin");
          res.writeHead(response.statusCode, { Location: response.location });
          res.end();
          return;
        }

        const form = await readFormBody(req);
        const sourceId = form.get("sourceId")?.trim() || undefined;
        const respectIntervals = ["1", "true", "yes", "on"].includes(
          (form.get("respectIntervals") ?? "").toLowerCase(),
        );
        const results = await runCollection(sourceId, respectIntervals, { trigger: "manual" });
        const refreshedSources = listSourceStatuses(db, env.sourcesPath);
        const refreshedCollectorConfig = loadCollectorConfig(env.sourcesPath);
        const response = htmlResponse(200, renderAdminDashboardPage({
          serviceName: "Polvenn release collector",
          sourceConfigs: refreshedCollectorConfig.sources,
          sourceStatuses: refreshedSources,
          collectorSettings: refreshedCollectorConfig.settings ?? {},
          runHistory: db.listSourceRunHistory(25),
          lastRunResults: results,
          message: sourceId
            ? `Manual run completed for ${sourceId}.`
            : "Manual run completed.",
          tone: "success",
        }));
        res.writeHead(response.statusCode, { "Content-Type": "text/html; charset=utf-8" });
        res.end(response.body);
        return;
      }

      if (method === "POST" && url.pathname === "/admin/settings/save") {
        if (!adminAuthorized) {
          const response = redirectResponse("/admin");
          res.writeHead(response.statusCode, { Location: response.location });
          res.end();
          return;
        }

        const form = await readFormBody(req);
        try {
          const settings = parseSettingsForm(Object.fromEntries(form.entries()));
          saveCollectorSettings(env.sourcesPath, settings);
          const refreshedCollectorConfig = loadCollectorConfig(env.sourcesPath);
          const response = htmlResponse(200, renderAdminDashboardPage({
            serviceName: "Polvenn release collector",
            sourceConfigs: refreshedCollectorConfig.sources,
            sourceStatuses: listSourceStatuses(db, env.sourcesPath),
            collectorSettings: refreshedCollectorConfig.settings ?? {},
            runHistory: db.listSourceRunHistory(25),
            message: "Saved collector settings.",
            tone: "success",
          }));
          res.writeHead(response.statusCode, { "Content-Type": "text/html; charset=utf-8" });
          res.end(response.body);
          return;
        } catch (error: unknown) {
          const response = htmlResponse(400, renderAdminDashboardPage({
            serviceName: "Polvenn release collector",
            sourceConfigs,
            sourceStatuses: sources,
            collectorSettings,
            runHistory,
            message: error instanceof Error ? error.message : "Could not save settings.",
            tone: "error",
          }));
          res.writeHead(response.statusCode, { "Content-Type": "text/html; charset=utf-8" });
          res.end(response.body);
          return;
        }
      }

      if (method === "POST" && url.pathname === "/admin/import/preview") {
        if (!adminAuthorized) {
          const response = redirectResponse("/admin");
          res.writeHead(response.statusCode, { Location: response.location });
          res.end();
          return;
        }

        const form = await readFormBody(req);
        const importType = (form.get("importType")?.trim() ?? "") as ImportPreviewType;
        const previewId = randomUUID();

        try {
          let pendingImport: PendingImport;

          if (importType === "config") {
            const config = parseCollectorConfigImport(form.get("configPayload") ?? "");
            pendingImport = {
              type: "config",
              preview: buildConfigPreviewSummary({
                id: previewId,
                currentConfig: collectorConfig,
                importedConfig: config,
              }),
              config,
            };
          } else if (importType === "bundle") {
            const bundle = parseCollectorExportBundle(form.get("bundlePayload") ?? "");
            const currentStats = db.getStats();
            pendingImport = {
              type: "bundle",
              preview: buildBundlePreviewSummary({
                id: previewId,
                currentConfig: collectorConfig,
                currentStats: {
                  releaseCount: currentStats.releaseCount,
                  sourceRunCount: currentStats.sourceRunCount,
                  runHistoryCount: currentStats.runHistoryCount,
                },
                importedBundle: bundle,
              }),
              bundle,
            };
          } else if (importType === "database") {
            const buffer = decodeBase64FilePayload(form.get("databasePayload") ?? "");
            const previewDir = path.join(env.dataDir, "import-previews");
            const tempPath = path.join(previewDir, `${previewId}.db`);
            fs.mkdirSync(previewDir, { recursive: true });
            fs.writeFileSync(tempPath, buffer);

            const previewDb = new ReleaseDatabase(tempPath);
            await previewDb.init();
            const stats = previewDb.getStats();
            previewDb.close();
            const currentStats = db.getStats();

            pendingImport = {
              type: "database",
              preview: buildDatabasePreviewSummary({
                id: previewId,
                sizeBytes: buffer.length,
                currentReleaseCount: currentStats.releaseCount,
                currentSourceRunCount: currentStats.sourceRunCount,
                currentRunHistoryCount: currentStats.runHistoryCount,
                releaseCount: stats.releaseCount,
                sourceRunCount: stats.sourceRunCount,
                runHistoryCount: stats.runHistoryCount,
              }),
              databaseTempPath: tempPath,
            };
          } else {
            throw new Error("Unsupported import type.");
          }

          pendingImports.set(previewId, pendingImport);

          const refreshedCollectorConfig = loadCollectorConfig(env.sourcesPath);
          const response = renderAdminResponse({
            serviceName: "Polvenn release collector",
            sourceConfigs: refreshedCollectorConfig.sources,
            sourceStatuses: listSourceStatuses(db, env.sourcesPath),
            collectorSettings: refreshedCollectorConfig.settings ?? {},
            runHistory: db.listSourceRunHistory(25),
            importPreview: pendingImport.preview,
            message: "Review the restore preview before applying it.",
            tone: "info",
          });
          res.writeHead(response.statusCode, { "Content-Type": "text/html; charset=utf-8" });
          res.end(response.body);
          return;
        } catch (error: unknown) {
          cleanupPendingImport(previewId);
          const response = renderAdminResponse({
            serviceName: "Polvenn release collector",
            sourceConfigs,
            sourceStatuses: sources,
            collectorSettings,
            runHistory,
            message: error instanceof Error ? error.message : "Could not preview import.",
            tone: "error",
          });
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(response.body);
          return;
        }
      }

      if (method === "POST" && url.pathname === "/admin/import/apply") {
        if (!adminAuthorized) {
          const response = redirectResponse("/admin");
          res.writeHead(response.statusCode, { Location: response.location });
          res.end();
          return;
        }

        const form = await readFormBody(req);
        const previewId = form.get("previewId")?.trim() ?? "";
        const pendingImport = pendingImports.get(previewId);
        if (!pendingImport) {
          const response = renderAdminResponse({
            serviceName: "Polvenn release collector",
            sourceConfigs,
            sourceStatuses: sources,
            collectorSettings,
            runHistory,
            message: "Restore preview not found or expired.",
            tone: "error",
          });
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(response.body);
          return;
        }

        try {
          const selection = parseRestoreSelection(Object.fromEntries(form.entries()));
          const snapshotDir = createBackupSnapshot();
          if (pendingImport.type === "config" && pendingImport.config) {
            saveCollectorConfig(
              env.sourcesPath,
              mergeCollectorConfig(collectorConfig, selection, pendingImport.config),
            );
          } else if (pendingImport.type === "bundle" && pendingImport.bundle) {
            const currentSnapshot = db.getDataSnapshot();
            saveCollectorConfig(
              env.sourcesPath,
              mergeCollectorConfig(collectorConfig, selection, {
                settings: pendingImport.bundle.settings,
                sources: pendingImport.bundle.sources,
              }),
            );
            db.replaceAllData({
              releases: selection.applyReleases
                ? pendingImport.bundle.latestReleases
                : currentSnapshot.releases,
              sourceRuns: selection.applySourceRuns
                ? pendingImport.bundle.sourceRuns
                : currentSnapshot.sourceRuns,
              runHistory: selection.applyRunHistory
                ? pendingImport.bundle.recentRuns
                : currentSnapshot.runHistory,
            });
          } else if (pendingImport.type === "database" && pendingImport.databaseTempPath) {
            const previewDb = new ReleaseDatabase(pendingImport.databaseTempPath);
            await previewDb.init();
            const importedSnapshot = previewDb.getDataSnapshot();
            previewDb.close();

            if (selection.applyReleases && selection.applySourceRuns && selection.applyRunHistory) {
              fs.copyFileSync(pendingImport.databaseTempPath, env.dbPath);
              await db.reloadFromDisk();
            } else {
              const currentSnapshot = db.getDataSnapshot();
              db.replaceAllData({
                releases: selection.applyReleases
                  ? importedSnapshot.releases
                  : currentSnapshot.releases,
                sourceRuns: selection.applySourceRuns
                  ? importedSnapshot.sourceRuns
                  : currentSnapshot.sourceRuns,
                runHistory: selection.applyRunHistory
                  ? importedSnapshot.runHistory
                  : currentSnapshot.runHistory,
              });
            }
          } else {
            throw new Error("Restore preview is incomplete.");
          }

          cleanupPendingImport(previewId);
          const refreshedCollectorConfig = loadCollectorConfig(env.sourcesPath);
          const response = renderAdminResponse({
            serviceName: "Polvenn release collector",
            sourceConfigs: refreshedCollectorConfig.sources,
            sourceStatuses: listSourceStatuses(db, env.sourcesPath),
            collectorSettings: refreshedCollectorConfig.settings ?? {},
            runHistory: db.listSourceRunHistory(25),
            message: `Restore applied. Backup snapshot created at ${snapshotDir}.`,
            tone: "success",
          });
          res.writeHead(response.statusCode, { "Content-Type": "text/html; charset=utf-8" });
          res.end(response.body);
          return;
        } catch (error: unknown) {
          const response = renderAdminResponse({
            serviceName: "Polvenn release collector",
            sourceConfigs,
            sourceStatuses: sources,
            collectorSettings,
            runHistory,
            importPreview: pendingImport.preview,
            message: error instanceof Error ? error.message : "Could not apply restore.",
            tone: "error",
          });
          res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
          res.end(response.body);
          return;
        }
      }

      if (method === "POST" && url.pathname === "/admin/import/cancel") {
        if (!adminAuthorized) {
          const response = redirectResponse("/admin");
          res.writeHead(response.statusCode, { Location: response.location });
          res.end();
          return;
        }

        const form = await readFormBody(req);
        const previewId = form.get("previewId")?.trim() ?? "";
        cleanupPendingImport(previewId);
        const refreshedCollectorConfig = loadCollectorConfig(env.sourcesPath);
        const response = renderAdminResponse({
          serviceName: "Polvenn release collector",
          sourceConfigs: refreshedCollectorConfig.sources,
          sourceStatuses: listSourceStatuses(db, env.sourcesPath),
          collectorSettings: refreshedCollectorConfig.settings ?? {},
          runHistory: db.listSourceRunHistory(25),
          message: "Restore preview cancelled.",
          tone: "info",
        });
        res.writeHead(response.statusCode, { "Content-Type": "text/html; charset=utf-8" });
        res.end(response.body);
        return;
      }

      if (method === "POST" && url.pathname === "/admin/import/config") {
        if (!adminAuthorized) {
          const response = redirectResponse("/admin");
          res.writeHead(response.statusCode, { Location: response.location });
          res.end();
          return;
        }

        const form = await readFormBody(req);
        try {
          const importedConfig = parseCollectorConfigImport(form.get("configPayload") ?? "");
          const snapshotDir = createBackupSnapshot();
          saveCollectorConfig(env.sourcesPath, importedConfig);
          const refreshedCollectorConfig = loadCollectorConfig(env.sourcesPath);
          const response = renderAdminResponse({
            serviceName: "Polvenn release collector",
            sourceConfigs: refreshedCollectorConfig.sources,
            sourceStatuses: listSourceStatuses(db, env.sourcesPath),
            collectorSettings: refreshedCollectorConfig.settings ?? {},
            runHistory: db.listSourceRunHistory(25),
            message: `Imported collector config. Backup snapshot created at ${snapshotDir}.`,
            tone: "success",
          });
          res.writeHead(response.statusCode, { "Content-Type": "text/html; charset=utf-8" });
          res.end(response.body);
          return;
        } catch (error: unknown) {
          const response = renderAdminResponse({
            serviceName: "Polvenn release collector",
            sourceConfigs,
            sourceStatuses: sources,
            collectorSettings,
            runHistory,
            message: error instanceof Error ? error.message : "Could not import config.",
            tone: "error",
          });
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(response.body);
          return;
        }
      }

      if (method === "POST" && url.pathname === "/admin/import/bundle") {
        if (!adminAuthorized) {
          const response = redirectResponse("/admin");
          res.writeHead(response.statusCode, { Location: response.location });
          res.end();
          return;
        }

        const form = await readFormBody(req);
        try {
          const importedBundle = parseCollectorExportBundle(form.get("bundlePayload") ?? "");
          const snapshotDir = createBackupSnapshot();
          saveCollectorConfig(env.sourcesPath, {
            settings: importedBundle.settings,
            sources: importedBundle.sources,
          });
          db.replaceAllData({
            releases: importedBundle.latestReleases,
            sourceRuns: importedBundle.sourceRuns,
            runHistory: importedBundle.recentRuns,
          });
          const refreshedCollectorConfig = loadCollectorConfig(env.sourcesPath);
          const response = renderAdminResponse({
            serviceName: "Polvenn release collector",
            sourceConfigs: refreshedCollectorConfig.sources,
            sourceStatuses: listSourceStatuses(db, env.sourcesPath),
            collectorSettings: refreshedCollectorConfig.settings ?? {},
            runHistory: db.listSourceRunHistory(25),
            message: `Imported full collector bundle. Backup snapshot created at ${snapshotDir}.`,
            tone: "success",
          });
          res.writeHead(response.statusCode, { "Content-Type": "text/html; charset=utf-8" });
          res.end(response.body);
          return;
        } catch (error: unknown) {
          const response = renderAdminResponse({
            serviceName: "Polvenn release collector",
            sourceConfigs,
            sourceStatuses: sources,
            collectorSettings,
            runHistory,
            message: error instanceof Error ? error.message : "Could not import bundle.",
            tone: "error",
          });
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(response.body);
          return;
        }
      }

      if (method === "POST" && url.pathname === "/admin/sources/save") {
        if (!adminAuthorized) {
          const response = redirectResponse("/admin");
          res.writeHead(response.statusCode, { Location: response.location });
          res.end();
          return;
        }

        const form = await readFormBody(req);
        try {
          const sourceConfig = parseSourceConfigForm(Object.fromEntries(form.entries()));
          const updatedSourceConfigs = upsertSourceConfig(env.sourcesPath, sourceConfig);
          const refreshedSources = listSourceStatuses(db, env.sourcesPath);
          const refreshedCollectorConfig = loadCollectorConfig(env.sourcesPath);
          const response = htmlResponse(200, renderAdminDashboardPage({
            serviceName: "Polvenn release collector",
            sourceConfigs: updatedSourceConfigs,
            sourceStatuses: refreshedSources,
            collectorSettings: refreshedCollectorConfig.settings ?? {},
            runHistory: db.listSourceRunHistory(25),
            message: `Saved source ${sourceConfig.id}.`,
            tone: "success",
          }));
          res.writeHead(response.statusCode, { "Content-Type": "text/html; charset=utf-8" });
          res.end(response.body);
          return;
        } catch (error: unknown) {
          const response = htmlResponse(400, renderAdminDashboardPage({
            serviceName: "Polvenn release collector",
            sourceConfigs,
            sourceStatuses: sources,
            collectorSettings,
            runHistory,
            message: error instanceof Error ? error.message : "Could not save source.",
            tone: "error",
          }));
          res.writeHead(response.statusCode, { "Content-Type": "text/html; charset=utf-8" });
          res.end(response.body);
          return;
        }
      }

      if (method === "POST" && url.pathname === "/admin/sources/test") {
        if (!adminAuthorized) {
          const response = redirectResponse("/admin");
          res.writeHead(response.statusCode, { Location: response.location });
          res.end();
          return;
        }

        const form = await readFormBody(req);
        const sourceId = form.get("sourceId")?.trim() ?? "";
        if (!sourceId) {
          const response = htmlResponse(400, renderAdminDashboardPage({
            serviceName: "Polvenn release collector",
            sourceConfigs,
            sourceStatuses: sources,
            collectorSettings,
            runHistory,
            message: "Missing source ID for test run.",
            tone: "error",
          }));
          res.writeHead(response.statusCode, { "Content-Type": "text/html; charset=utf-8" });
          res.end(response.body);
          return;
        }

        const results = await runCollection(sourceId, false, {
          persistResults: false,
          trigger: "test",
        });
        const refreshedSources = listSourceStatuses(db, env.sourcesPath);
        const refreshedCollectorConfig = loadCollectorConfig(env.sourcesPath);
        const response = htmlResponse(200, renderAdminDashboardPage({
          serviceName: "Polvenn release collector",
          sourceConfigs: refreshedCollectorConfig.sources,
          sourceStatuses: refreshedSources,
          collectorSettings: refreshedCollectorConfig.settings ?? {},
          runHistory: db.listSourceRunHistory(25),
          lastRunResults: results,
          message: `Tested source ${sourceId} without persisting feed data.`,
          tone: "success",
        }));
        res.writeHead(response.statusCode, { "Content-Type": "text/html; charset=utf-8" });
        res.end(response.body);
        return;
      }

      if (method === "POST" && url.pathname === "/admin/sources/delete") {
        if (!adminAuthorized) {
          const response = redirectResponse("/admin");
          res.writeHead(response.statusCode, { Location: response.location });
          res.end();
          return;
        }

        const form = await readFormBody(req);
        const sourceId = form.get("sourceId")?.trim() ?? "";
        if (!sourceId) {
          const response = htmlResponse(400, renderAdminDashboardPage({
            serviceName: "Polvenn release collector",
            sourceConfigs,
            sourceStatuses: sources,
            collectorSettings,
            runHistory,
            message: "Missing source ID.",
            tone: "error",
          }));
          res.writeHead(response.statusCode, { "Content-Type": "text/html; charset=utf-8" });
          res.end(response.body);
          return;
        }

        const updatedSourceConfigs = removeSourceConfig(env.sourcesPath, sourceId);
        const refreshedSources = listSourceStatuses(db, env.sourcesPath);
        const refreshedCollectorConfig = loadCollectorConfig(env.sourcesPath);
        const response = htmlResponse(200, renderAdminDashboardPage({
          serviceName: "Polvenn release collector",
          sourceConfigs: updatedSourceConfigs,
          sourceStatuses: refreshedSources,
          collectorSettings: refreshedCollectorConfig.settings ?? {},
          runHistory: db.listSourceRunHistory(25),
          message: `Deleted source ${sourceId}.`,
          tone: "success",
        }));
        res.writeHead(response.statusCode, { "Content-Type": "text/html; charset=utf-8" });
        res.end(response.body);
        return;
      }

      if (method === "POST" && url.pathname === "/admin/backups/create") {
        if (!adminAuthorized) {
          const response = redirectResponse("/admin");
          res.writeHead(response.statusCode, { Location: response.location });
          res.end();
          return;
        }

        const snapshotDir = createBackupSnapshot();
        const refreshedCollectorConfig = loadCollectorConfig(env.sourcesPath);
        const response = htmlResponse(200, renderAdminDashboardPage({
          serviceName: "Polvenn release collector",
          sourceConfigs: refreshedCollectorConfig.sources,
          sourceStatuses: listSourceStatuses(db, env.sourcesPath),
          collectorSettings: refreshedCollectorConfig.settings ?? {},
          runHistory: db.listSourceRunHistory(25),
          message: `Created backup snapshot at ${snapshotDir}.`,
          tone: "success",
        }));
        res.writeHead(response.statusCode, { "Content-Type": "text/html; charset=utf-8" });
        res.end(response.body);
        return;
      }

      if (method === "GET" && url.pathname === "/admin/export/config") {
        if (!adminAuthorized) {
          const response = redirectResponse("/admin");
          res.writeHead(response.statusCode, { Location: response.location });
          res.end();
          return;
        }

        const payload = JSON.stringify(loadCollectorConfig(env.sourcesPath), null, 2);
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Disposition": "attachment; filename=\"polvenn-release-collector.config.json\"",
        });
        res.end(payload);
        return;
      }

      if (method === "GET" && url.pathname === "/admin/export/bundle") {
        if (!adminAuthorized) {
          const response = redirectResponse("/admin");
          res.writeHead(response.statusCode, { Location: response.location });
          res.end();
          return;
        }

        const payload = JSON.stringify({
          exportedAt: new Date().toISOString(),
          service: "polvenn-release-collector",
          host: "beer.ogard.cloud",
          settings: collectorSettings,
          sources: sourceConfigs,
          sourceRuns: db.listSourceRuns(),
          recentRuns: db.listSourceRunHistory(100),
          latestReleases: db.listLatestReleases(100),
        }, null, 2);
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Disposition": "attachment; filename=\"polvenn-release-collector-export.json\"",
        });
        res.end(payload);
        return;
      }

      if (method === "GET" && url.pathname === "/admin/export/database") {
        if (!adminAuthorized) {
          const response = redirectResponse("/admin");
          res.writeHead(response.statusCode, { Location: response.location });
          res.end();
          return;
        }

        if (!fs.existsSync(env.dbPath)) {
          const response = jsonResponse(404, { error: "Database file not found." });
          res.writeHead(response.statusCode, { "Content-Type": "application/json" });
          res.end(response.body);
          return;
        }

        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": "attachment; filename=\"polvenn-release-collector.db\"",
        });
        res.end(fs.readFileSync(env.dbPath));
        return;
      }

      if (method === "GET" && (url.pathname === "/" || url.pathname === "/status")) {
        if (!env.publicStatusPage) {
          const response = jsonResponse(404, { error: "Not found" });
          res.writeHead(response.statusCode, { "Content-Type": "application/json" });
          res.end(response.body);
          return;
        }

        const response = htmlResponse(200, renderStatusPage({
          serviceName: "Polvenn release collector",
          releaseFeedPath: "/releases/latest?limit=3",
          healthPath: "/health",
          sources,
          adminProtected: Boolean(env.adminToken),
        }));
        res.writeHead(response.statusCode, { "Content-Type": "text/html; charset=utf-8" });
        res.end(response.body);
        return;
      }

      if (method === "GET" && url.pathname === "/health") {
        const runtimeWebhook = getRuntimeWebhookConfig(collectorSettings);
        const response = jsonResponse(200, {
          ok: true,
          service: "polvenn-release-collector",
          sourcesPath: env.sourcesPath,
          dbPath: env.dbPath,
          schedulerIntervalMinutes: env.schedulerIntervalMinutes,
          adminProtected: Boolean(env.adminToken),
          webhookEnabled: Boolean(runtimeWebhook.url),
        });
        res.writeHead(response.statusCode, { "Content-Type": "application/json" });
        res.end(response.body);
        return;
      }

      if (method === "GET" && url.pathname === "/releases/latest") {
        const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "3", 10);
        const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 3;
        const response = jsonResponse(200, {
          releases: db.listLatestReleases(limit),
        });
        res.writeHead(response.statusCode, { "Content-Type": "application/json" });
        res.end(response.body);
        return;
      }

      if (method === "GET" && url.pathname === "/sources") {
        if (!adminAuthorized) {
          const response = jsonResponse(401, { error: "Unauthorized" });
          res.writeHead(response.statusCode, {
            "Content-Type": "application/json",
            "WWW-Authenticate": "Bearer",
          });
          res.end(response.body);
          return;
        }

        const response = jsonResponse(200, {
          sources,
        });
        res.writeHead(response.statusCode, { "Content-Type": "application/json" });
        res.end(response.body);
        return;
      }

      if (method === "GET" && url.pathname === "/runs") {
        if (!adminAuthorized) {
          const response = jsonResponse(401, { error: "Unauthorized" });
          res.writeHead(response.statusCode, {
            "Content-Type": "application/json",
            "WWW-Authenticate": "Bearer",
          });
          res.end(response.body);
          return;
        }

        const sourceId = url.searchParams.get("source") ?? undefined;
        const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
        const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50;
        const response = jsonResponse(200, {
          runs: db.listSourceRunHistory(limit, sourceId),
        });
        res.writeHead(response.statusCode, { "Content-Type": "application/json" });
        res.end(response.body);
        return;
      }

      if (method === "POST" && url.pathname === "/collect") {
        if (!adminAuthorized) {
          const response = jsonResponse(401, { error: "Unauthorized" });
          res.writeHead(response.statusCode, {
            "Content-Type": "application/json",
            "WWW-Authenticate": "Bearer",
          });
          res.end(response.body);
          return;
        }

        const sourceId = url.searchParams.get("source") ?? undefined;
        const respectIntervals = ["1", "true", "yes", "on"].includes(
          (url.searchParams.get("respectIntervals") ?? "").toLowerCase(),
        );
        const results = await runCollection(sourceId, respectIntervals, { trigger: "manual" });
        const response = jsonResponse(200, {
          ok: true,
          sourceId: sourceId ?? null,
          respectIntervals,
          results,
        });
        res.writeHead(response.statusCode, { "Content-Type": "application/json" });
        res.end(response.body);
        return;
      }

      const response = jsonResponse(404, { error: "Not found" });
      res.writeHead(response.statusCode, { "Content-Type": "application/json" });
      res.end(response.body);
    } catch (error: unknown) {
      console.error("Request failed:", error);
      const response = jsonResponse(500, {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      res.writeHead(response.statusCode, { "Content-Type": "application/json" });
      res.end(response.body);
    }
  });

  server.listen(env.port, () => {
    console.error(`Polvenn release collector listening on http://127.0.0.1:${env.port}`);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
