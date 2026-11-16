import sqlite3InitModule, { type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { Server } from '@pillage-first/types/models/server';
import {
  createDbFacade,
  type DbFacade,
} from '@pillage-first/utils/facades/database';
import { migrateAndSeed } from '../db';

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

/**
 * Scaffold host DB for the game-server vertical slice.
 *
 * Online persistence target is MySQL (`apps/game-server` mysql adapter). Until
 * game SQL/schemas are ported, the always-on scheduler reuses the existing
 * SQLite WASM + `migrateAndSeed` kernel so resolvers stay unforked.
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
