import { z } from 'zod';
import type { Server } from '@pillage-first/types/models/server';
import { migrateAndSeed } from '../db';
import type { HostDatabase } from './node-database.ts';
import {
  createMysqlDbFacade,
  type MysqlConnectionConfig,
  openMysqlSyncClient,
} from './mysql/mysql-db-facade.ts';

export type OpenMysqlHostDatabaseOptions = {
  readonly config: MysqlConnectionConfig;
  readonly server: Server;
  /**
   * When true (default), run migrateAndSeed only if the game schema is empty.
   * Existing MySQL game data is reused so events survive process restart.
   */
  readonly seedIfEmpty?: boolean;
};

const tableExists = (database: HostDatabase, tableName: string): boolean => {
  const count = database.selectValue({
    sql: `
      SELECT COUNT(*) AS cnt
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = $tableName
    `,
    bind: { $tableName: tableName },
    schema: z.coerce.number(),
  });
  return (count ?? 0) > 0;
};

const isGameSchemaSeeded = (database: HostDatabase): boolean => {
  if (!tableExists(database, 'servers') || !tableExists(database, 'events')) {
    return false;
  }

  const serverCount = database.selectValue({
    sql: 'SELECT COUNT(*) AS cnt FROM servers',
    schema: z.coerce.number(),
  });

  return (serverCount ?? 0) > 0;
};

/**
 * Open a MySQL-backed host database for the online game kernel.
 *
 * Game tables live in the same schema as `online_*` meta tables (no prefix).
 * Offline OPFS/SQLite is untouched — this path is Node/host only.
 */
export const openMysqlHostDatabase = async (
  options: OpenMysqlHostDatabaseOptions,
): Promise<HostDatabase> => {
  const seedIfEmpty = options.seedIfEmpty ?? true;
  const client = openMysqlSyncClient(options.config);
  const facade = createMysqlDbFacade(client);

  // Disable FK checks while applying TEMP lookup tables + seed order
  // (mirrors SQLite PRAGMA foreign_keys = OFF during migrateAndSeed).
  try {
    facade.exec({ sql: 'SET FOREIGN_KEY_CHECKS = 0' });

    const alreadySeeded = isGameSchemaSeeded(facade);

    if (!alreadySeeded) {
      migrateAndSeed(facade, options.server);
    } else if (!seedIfEmpty) {
      // Re-seed requested but schema exists — leave data in place (no wipe).
    }

    facade.exec({ sql: 'SET FOREIGN_KEY_CHECKS = 1' });
  } catch (error) {
    try {
      facade.close();
    } catch {
      // ignore close errors during open failure
    }
    throw error;
  }

  return facade;
};

export type { MysqlConnectionConfig };
