declare module "sql.js" {
  export interface QueryResult {
    columns: string[];
    values: unknown[][];
  }

  export interface Database {
    run(sql: string, params?: unknown[]): void;
    exec(sql: string, params?: unknown[]): QueryResult[];
    export(): Uint8Array;
    close(): void;
  }

  export default function initSqlJs(config?: unknown): Promise<{
    Database: new (data?: Uint8Array | Buffer | ArrayBuffer) => Database;
  }>;
}
