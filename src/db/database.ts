import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import fs from "node:fs";
import path from "node:path";
import type {
  ReleaseRecord,
  SourceRunHistoryEntry,
  StoredSourceRunInfo,
} from "../types/releases.js";

export class ReleaseDatabase {
  private db: SqlJsDatabase | null = null;

  constructor(private readonly dbPath: string) {}

  async init(): Promise<void> {
    if (this.db) {
      return;
    }

    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });

    const SQL = await initSqlJs();
    if (fs.existsSync(this.dbPath)) {
      this.db = new SQL.Database(fs.readFileSync(this.dbPath));
    } else {
      this.db = new SQL.Database();
    }

    this.db.run(`
      CREATE TABLE IF NOT EXISTS releases (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        source TEXT NOT NULL,
        published_at TEXT NOT NULL,
        url TEXT,
        collected_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS release_items (
        release_id TEXT NOT NULL,
        article_number TEXT NOT NULL,
        producer TEXT NOT NULL,
        name TEXT NOT NULL,
        style TEXT NOT NULL,
        abv REAL NOT NULL,
        country TEXT,
        release_date TEXT NOT NULL,
        PRIMARY KEY (release_id, article_number),
        FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS source_runs (
        source_id TEXT PRIMARY KEY,
        last_run_at TEXT,
        last_success_at TEXT,
        last_error_at TEXT,
        last_error_message TEXT,
        last_status TEXT,
        last_run_duration_ms INTEGER
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS source_run_history (
        run_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        source_name TEXT NOT NULL,
        trigger TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        releases_collected INTEGER NOT NULL,
        new_release_count INTEGER NOT NULL,
        new_release_titles TEXT NOT NULL,
        diff_json TEXT NOT NULL DEFAULT '{"newReleases":[]}',
        error_message TEXT,
        persisted INTEGER NOT NULL,
        respected_intervals INTEGER NOT NULL
      )
    `);

    this.ensureSourceRunColumns();
    this.ensureSourceRunHistoryColumns();

    this.persist();
  }

  private get requiredDb(): SqlJsDatabase {
    if (!this.db) {
      throw new Error("Database not initialized.");
    }
    return this.db;
  }

  async reloadFromDisk(): Promise<void> {
    this.db?.close();
    this.db = null;
    await this.init();
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private persist(): void {
    const db = this.requiredDb;
    fs.writeFileSync(this.dbPath, Buffer.from(db.export()));
  }

  private upsertReleaseWithoutPersist(release: ReleaseRecord): void {
    const db = this.requiredDb;

    db.run(
      `
        INSERT OR REPLACE INTO releases (id, title, source, published_at, url, collected_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `,
      [release.id, release.title, release.source, release.publishedAt, release.url],
    );

    db.run("DELETE FROM release_items WHERE release_id = ?", [release.id]);

    for (const item of release.items) {
      db.run(
        `
          INSERT INTO release_items (
            release_id,
            article_number,
            producer,
            name,
            style,
            abv,
            country,
            release_date
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          release.id,
          item.articleNumber,
          item.producer,
          item.name,
          item.style,
          item.abv,
          item.country,
          item.releaseDate,
        ],
      );
    }
  }

  private recordSourceRunWithoutPersist(result: {
    sourceId: string;
    lastRunAt: string;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastErrorMessage: string | null;
    lastStatus: "success" | "error";
    lastRunDurationMs: number;
  }): void {
    const db = this.requiredDb;
    db.run(
      `
        INSERT OR REPLACE INTO source_runs (
          source_id,
          last_run_at,
          last_success_at,
          last_error_at,
          last_error_message,
          last_status,
          last_run_duration_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        result.sourceId,
        result.lastRunAt,
        result.lastSuccessAt,
        result.lastErrorAt,
        result.lastErrorMessage,
        result.lastStatus,
        result.lastRunDurationMs,
      ],
    );
  }

  private recordSourceRunHistoryWithoutPersist(entry: SourceRunHistoryEntry): void {
    const db = this.requiredDb;
    db.run(
      `
        INSERT OR REPLACE INTO source_run_history (
          run_id,
          source_id,
          source_name,
          trigger,
          status,
          started_at,
          completed_at,
          duration_ms,
          releases_collected,
          new_release_count,
          new_release_titles,
          diff_json,
          error_message,
          persisted,
          respected_intervals
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        entry.runId,
        entry.sourceId,
        entry.sourceName,
        entry.trigger,
        entry.status,
        entry.startedAt,
        entry.completedAt,
        entry.durationMs,
        entry.releasesCollected,
        entry.newReleaseCount,
        JSON.stringify(entry.newReleaseTitles),
        JSON.stringify(entry.diff),
        entry.errorMessage,
        entry.persisted ? 1 : 0,
        entry.respectedIntervals ? 1 : 0,
      ],
    );
  }

  private ensureSourceRunColumns(): void {
    const db = this.requiredDb;
    const result = db.exec("PRAGMA table_info(source_runs)");
    const columnNames = new Set(
      (result[0]?.values ?? []).map((row: unknown[]) => String(row[1])),
    );

    const requiredColumns: Array<{ name: string; type: string }> = [
      { name: "last_success_at", type: "TEXT" },
      { name: "last_error_at", type: "TEXT" },
      { name: "last_error_message", type: "TEXT" },
      { name: "last_status", type: "TEXT" },
      { name: "last_run_duration_ms", type: "INTEGER" },
    ];

    for (const column of requiredColumns) {
      if (!columnNames.has(column.name)) {
        db.run(`ALTER TABLE source_runs ADD COLUMN ${column.name} ${column.type}`);
      }
    }
  }

  private ensureSourceRunHistoryColumns(): void {
    const db = this.requiredDb;
    const result = db.exec("PRAGMA table_info(source_run_history)");
    const columnNames = new Set(
      (result[0]?.values ?? []).map((row: unknown[]) => String(row[1])),
    );

    if (!columnNames.has("diff_json")) {
      db.run("ALTER TABLE source_run_history ADD COLUMN diff_json TEXT NOT NULL DEFAULT '{\"newReleases\":[]}'");
    }
  }

  upsertRelease(release: ReleaseRecord): void {
    this.upsertReleaseWithoutPersist(release);
    this.persist();
  }

  getExistingReleaseIds(releaseIds: string[]): Set<string> {
    const db = this.requiredDb;
    if (releaseIds.length === 0) {
      return new Set<string>();
    }

    const placeholders = releaseIds.map(() => "?").join(", ");
    const result = db.exec(
      `
        SELECT id
        FROM releases
        WHERE id IN (${placeholders})
      `,
      releaseIds,
    );

    return new Set(
      (result[0]?.values ?? []).map((row: unknown[]) => row[0] as string),
    );
  }

  getSourceRunInfo(sourceId: string): StoredSourceRunInfo {
    const db = this.requiredDb;
    const result = db.exec(
      `
        SELECT source_id, last_run_at, last_success_at, last_error_at, last_error_message, last_status, last_run_duration_ms
        FROM source_runs
        WHERE source_id = ?
        LIMIT 1
      `,
      [sourceId],
    );

    const row = result[0]?.values[0];
    if (!row) {
      return {
        sourceId,
        lastRunAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
        lastStatus: null,
        lastRunDurationMs: null,
      };
    }

    const lastRunAt = typeof row[1] === "string" ? row[1] : null;
    const lastSuccessAt = typeof row[2] === "string" ? row[2] : null;
    const lastErrorAt = typeof row[3] === "string" ? row[3] : null;
    const lastErrorMessage = typeof row[4] === "string" ? row[4] : null;
    const lastStatus = row[5] === "success" || row[5] === "error" ? row[5] : null;
    const inferredSuccessAt = !lastStatus && lastRunAt && !lastErrorAt ? lastRunAt : null;

    return {
      sourceId,
      lastRunAt,
      lastSuccessAt: lastSuccessAt ?? inferredSuccessAt,
      lastErrorAt,
      lastErrorMessage,
      lastStatus: lastStatus ?? (inferredSuccessAt ? "success" : null),
      lastRunDurationMs: typeof row[6] === "number" ? row[6] : null,
    };
  }

  recordSourceRun(result: {
    sourceId: string;
    lastRunAt: string;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastErrorMessage: string | null;
    lastStatus: "success" | "error";
    lastRunDurationMs: number;
  }): void {
    this.recordSourceRunWithoutPersist(result);
    this.persist();
  }

  recordSourceRunHistory(entry: SourceRunHistoryEntry): void {
    this.recordSourceRunHistoryWithoutPersist(entry);
    this.persist();
  }

  listSourceRuns(): StoredSourceRunInfo[] {
    const db = this.requiredDb;
    const result = db.exec(
      `
        SELECT source_id, last_run_at, last_success_at, last_error_at, last_error_message, last_status, last_run_duration_ms
        FROM source_runs
        ORDER BY source_id ASC
      `,
    );

    return (result[0]?.values ?? []).map((row: unknown[]) => ({
      sourceId: row[0] as string,
      lastRunAt: typeof row[1] === "string" ? row[1] : null,
      lastSuccessAt: typeof row[2] === "string" ? row[2] : null,
      lastErrorAt: typeof row[3] === "string" ? row[3] : null,
      lastErrorMessage: typeof row[4] === "string" ? row[4] : null,
      lastStatus: row[5] === "success" || row[5] === "error" ? row[5] : null,
      lastRunDurationMs: typeof row[6] === "number" ? row[6] : null,
    }));
  }

  listAllSourceRunHistory(): SourceRunHistoryEntry[] {
    return this.listSourceRunHistory(Number.MAX_SAFE_INTEGER);
  }

  getStats(): {
    releaseCount: number;
    releaseItemCount: number;
    sourceRunCount: number;
    runHistoryCount: number;
  } {
    const db = this.requiredDb;
    const readCount = (table: string): number => {
      const result = db.exec(`SELECT COUNT(*) FROM ${table}`);
      const value = result[0]?.values[0]?.[0];
      return typeof value === "number" ? value : 0;
    };

    return {
      releaseCount: readCount("releases"),
      releaseItemCount: readCount("release_items"),
      sourceRunCount: readCount("source_runs"),
      runHistoryCount: readCount("source_run_history"),
    };
  }

  getDataSnapshot(): {
    releases: ReleaseRecord[];
    sourceRuns: StoredSourceRunInfo[];
    runHistory: SourceRunHistoryEntry[];
  } {
    return {
      releases: this.listAllReleases(),
      sourceRuns: this.listSourceRuns(),
      runHistory: this.listAllSourceRunHistory(),
    };
  }

  replaceAllData(payload: {
    releases: ReleaseRecord[];
    sourceRuns?: StoredSourceRunInfo[];
    runHistory?: SourceRunHistoryEntry[];
  }): void {
    const db = this.requiredDb;
    db.run("DELETE FROM release_items");
    db.run("DELETE FROM releases");
    db.run("DELETE FROM source_run_history");
    db.run("DELETE FROM source_runs");

    for (const release of payload.releases) {
      this.upsertReleaseWithoutPersist(release);
    }

    for (const sourceRun of payload.sourceRuns ?? []) {
      if (!sourceRun.lastRunAt || !sourceRun.lastStatus || sourceRun.lastRunDurationMs == null) {
        continue;
      }

      this.recordSourceRunWithoutPersist({
        sourceId: sourceRun.sourceId,
        lastRunAt: sourceRun.lastRunAt,
        lastSuccessAt: sourceRun.lastSuccessAt,
        lastErrorAt: sourceRun.lastErrorAt,
        lastErrorMessage: sourceRun.lastErrorMessage,
        lastStatus: sourceRun.lastStatus,
        lastRunDurationMs: sourceRun.lastRunDurationMs,
      });
    }

    for (const historyEntry of payload.runHistory ?? []) {
      this.recordSourceRunHistoryWithoutPersist(historyEntry);
    }

    this.persist();
  }

  listSourceRunHistory(limit = 100, sourceId?: string): SourceRunHistoryEntry[] {
    const db = this.requiredDb;
    const whereClause = sourceId ? "WHERE source_id = ?" : "";
    const params = sourceId ? [sourceId, limit] : [limit];
    const result = db.exec(
      `
        SELECT
          run_id,
          source_id,
          source_name,
          trigger,
          status,
          started_at,
          completed_at,
          duration_ms,
          releases_collected,
          new_release_count,
          new_release_titles,
          diff_json,
          error_message,
          persisted,
          respected_intervals
        FROM source_run_history
        ${whereClause}
        ORDER BY completed_at DESC, run_id DESC
        LIMIT ?
      `,
      params,
    );

    return (result[0]?.values ?? []).map((row: unknown[]) => ({
      runId: row[0] as string,
      sourceId: row[1] as string,
      sourceName: row[2] as string,
      trigger: row[3] as SourceRunHistoryEntry["trigger"],
      status: row[4] as SourceRunHistoryEntry["status"],
      startedAt: row[5] as string,
      completedAt: row[6] as string,
      durationMs: row[7] as number,
      releasesCollected: row[8] as number,
      newReleaseCount: row[9] as number,
      newReleaseTitles: JSON.parse((row[10] as string) || "[]") as string[],
      diff: JSON.parse((row[11] as string) || "{\"newReleases\":[]}"),
      errorMessage: (row[12] as string | null) ?? null,
      persisted: Boolean(row[13]),
      respectedIntervals: Boolean(row[14]),
    }));
  }

  listLatestReleases(limit: number): ReleaseRecord[] {
    const db = this.requiredDb;
    const releaseRows = db.exec(
      `
        SELECT id, title, source, published_at, url
        FROM releases
        ORDER BY published_at DESC, id DESC
        LIMIT ?
      `,
      [limit],
    );

    if (releaseRows.length === 0) {
      return [];
    }

    return releaseRows[0].values.map((row: unknown[]) => {
      const id = row[0] as string;
      const itemRows = db.exec(
        `
          SELECT article_number, producer, name, style, abv, country, release_date
          FROM release_items
          WHERE release_id = ?
          ORDER BY producer, name
        `,
        [id],
      );

      return {
        id,
        title: row[1] as string,
        source: row[2] as string,
        publishedAt: row[3] as string,
        url: (row[4] as string | null) ?? null,
        items: (itemRows[0]?.values ?? []).map((itemRow: unknown[]) => ({
          articleNumber: itemRow[0] as string,
          producer: itemRow[1] as string,
          name: itemRow[2] as string,
          style: itemRow[3] as string,
          abv: itemRow[4] as number,
          country: (itemRow[5] as string | null) ?? null,
          releaseDate: itemRow[6] as string,
        })),
      };
    });
  }

  listAllReleases(): ReleaseRecord[] {
    const stats = this.getStats();
    if (stats.releaseCount === 0) {
      return [];
    }

    return this.listLatestReleases(stats.releaseCount);
  }
}
