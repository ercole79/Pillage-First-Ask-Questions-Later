import sqlite3InitModule, { type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { Server } from '@pillage-first/types/models/server';
import {
  createDbFacade,
  type DbFacade,
} from '@pillage-first/utils/facades/database';
import { migrateAndSeed } from '../db';
import {
  type MysqlConnectionConfig,
  openMysqlHostDatabase,
} from './mysql-database.ts';

let sqlite3Promise: Promise<Sqlite3Static> | null = null;

const getSqlite3 = async (): Promise<Sqlite3Static> => {
  if (!sqlite3Promise) {
    sqlite3Promise = sqlite3InitModule();
  }

  return sqlite3Promise;
};

export type HostDatabase = DbFacade & {
  close: () => void;
};

export type HostDatabaseBackend = 'sqlite' | 'mysql';

export type OpenHostDatabaseOptions = {
  readonly server: Server;
  /**
   * `auto` (default for game-server): use MySQL when `mysql` config is provided
   * and reachable; otherwise fall back to in-memory SQLite WASM.
   */
  readonly backend?: HostDatabaseBackend | 'auto';
  readonly mysql?: MysqlConnectionConfig;
  readonly seedIfEmpty?: boolean;
};

/**
 * In-memory SQLite WASM host DB (dev fallback / tests).
 *
 * Online persistence target is MySQL — prefer `openHostDatabase` / MySQL when
 * reachable. Offline OPFS path remains `packages/api/src/worker/database.ts`.
 */
export const openSeededHostDatabase = async (
  server: Server,
): Promise<HostDatabase> => {
  const sqlite3 = await getSqlite3();
  const oo1Db = new sqlite3.oo1.DB(':memory:', 'c');

  const facade = createDbFacade(oo1Db, () =>
    sqlite3.capi.sqlite3_js_db_export(oo1Db.pointer!, 'main'),
  );

  // Match offline create-world pragmas for seed (FK off while temp lookup
  // tables are populated), then enable FK for authoritative runtime.
  facade.execMulti({
    sql: `
      PRAGMA page_size = 4096;
      PRAGMA locking_mode = EXCLUSIVE;
      PRAGMA journal_mode = MEMORY;
      PRAGMA synchronous = OFF;
      PRAGMA foreign_keys = OFF;
      PRAGMA temp_store = MEMORY;
      PRAGMA cache_size = -20000;
    `,
  });

  migrateAndSeed(facade, server);

  facade.exec({ sql: 'PRAGMA foreign_keys = ON;' });

  let closed = false;
  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    try {
      facade.close();
    } finally {
      oo1Db.close();
    }
  };

  return { ...facade, close };
};

/**
 * Open the online host database: MySQL when configured/reachable, else SQLite WASM.
 */
export const openHostDatabase = async (
  options: OpenHostDatabaseOptions,
): Promise<{ database: HostDatabase; backend: HostDatabaseBackend }> => {
  const backend = options.backend ?? 'auto';

  if (backend === 'sqlite') {
    return {
      database: await openSeededHostDatabase(options.server),
      backend: 'sqlite',
    };
  }

  if (backend === 'mysql') {
    if (!options.mysql) {
      throw new Error('MySQL backend requested but no mysql config provided');
    }
    return {
      database: await openMysqlHostDatabase({
        config: options.mysql,
        server: options.server,
        seedIfEmpty: options.seedIfEmpty,
      }),
      backend: 'mysql',
    };
  }

  // auto
  if (options.mysql) {
    try {
      const database = await openMysqlHostDatabase({
        config: options.mysql,
        server: options.server,
        seedIfEmpty: options.seedIfEmpty,
      });
      return { database, backend: 'mysql' };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(
        `[api/host] MySQL game DB unavailable (${detail}); falling back to SQLite WASM`,
      );
    }
  }

  return {
    database: await openSeededHostDatabase(options.server),
    backend: 'sqlite',
  };
};

export type { MysqlConnectionConfig };
