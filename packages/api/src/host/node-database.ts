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

export type HostDatabaseBackend = 'mysql';

export type OpenHostDatabaseOptions = {
  readonly server: Server;
  readonly mysql: MysqlConnectionConfig;
  readonly seedIfEmpty?: boolean;
};

/**
 * In-memory SQLite WASM host DB for **unit/integration tests** of shared
 * scheduler/resolvers only.
 *
 * Online game-server must use MySQL (`openMysqlHostDatabase` /
 * `openHostDatabase`). Offline OPFS path remains
 * `packages/api/src/worker/database.ts` and is unchanged.
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
 * Open the online host database (MySQL only — no SQLite fallback).
 *
 * Online players must share one authoritative MySQL store. Callers should
 * fail startup if this throws.
 */
export const openHostDatabase = async (
  options: OpenHostDatabaseOptions,
): Promise<{ database: HostDatabase; backend: HostDatabaseBackend }> => {
  if (!options.mysql) {
    throw new Error(
      'Online game DB requires MySQL config (host/user/password/database). There is no SQLite/WASM fallback for game-server.',
    );
  }

  try {
    const database = await openMysqlHostDatabase({
      config: options.mysql,
      server: options.server,
      seedIfEmpty: options.seedIfEmpty,
    });
    return { database, backend: 'mysql' };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Online game DB MySQL unavailable (${detail}). game-server refuses to start without MySQL so all players share one authoritative store.`,
      { cause: error },
    );
  }
};

export type { MysqlConnectionConfig };
