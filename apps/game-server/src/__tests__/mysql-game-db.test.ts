import { afterEach, describe, expect, test } from 'vitest';
import {
  cancelScheduling,
  openMysqlHostDatabase,
  resetSchedulerForTesting,
} from '@pillage-first/api/host';
import { serverMock } from '@pillage-first/mocks/server';
import { z } from 'zod';
import { getConfig } from '../config.ts';

const mysqlConfig = () => {
  const config = getConfig({
    ...process.env,
    MYSQL_HOST: process.env.MYSQL_HOST ?? '127.0.0.1',
    MYSQL_PORT: process.env.MYSQL_PORT ?? '3306',
    MYSQL_USER: process.env.MYSQL_USER ?? 'pillage',
    MYSQL_PASSWORD: process.env.MYSQL_PASSWORD ?? 'pillage',
    MYSQL_DATABASE: process.env.MYSQL_DATABASE ?? 'pillage_online',
  });
  const { host, port, user, password, database } = config.mysql;
  return { host, port, user, password, database };
};

const canReachMysql = async (): Promise<boolean> => {
  try {
    const mysql = await import('mysql2/promise');
    const connection = await mysql.createConnection({
      host: mysqlConfig().host,
      port: mysqlConfig().port,
      user: mysqlConfig().user,
      password: mysqlConfig().password,
      database: mysqlConfig().database,
    });
    await connection.ping();
    await connection.end();
    return true;
  } catch {
    return false;
  }
};

describe('MySQL game DbFacade', () => {
  afterEach(() => {
    cancelScheduling();
    resetSchedulerForTesting();
  });

  test('migrates schema and persists events across reopen', async () => {
    if (!(await canReachMysql())) {
      console.warn('Skipping MySQL game DB test — MySQL unreachable');
      return;
    }

    const config = mysqlConfig();
    const mysql = await import('mysql2/promise');

    // Isolate this test in a dedicated schema so we do not clobber shared state.
    const databaseName = `pillage_game_test_${Date.now()}`;
    const admin = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      multipleStatements: true,
    });
    await admin.query(
      `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    await admin.end();

    const testConfig = { ...config, database: databaseName };
    const server = {
      ...serverMock,
      id: globalThis.crypto.randomUUID(),
      slug: `mysql-test-${serverMock.slug}`,
      name: 'MySQL test world',
    };

    try {
      const first = await openMysqlHostDatabase({
        config: testConfig,
        server,
        seedIfEmpty: true,
      });

      expect(first.dialect).toBe('mysql');

      const villageId = first.selectValue({
        sql: 'SELECT id FROM villages ORDER BY id LIMIT 1',
        schema: z.coerce.number(),
      });
      expect(villageId).toBeTypeOf('number');

      first.exec({
        sql: `
          INSERT INTO events (type, starts_at, duration, village_id, meta)
          VALUES ('loyaltyIncrease', $startsAt, $duration, $villageId, NULL)
        `,
        bind: {
          $startsAt: Date.now(),
          $duration: 60_000,
          $villageId: villageId!,
        },
      });

      const eventCountBefore = first.selectValue({
        sql: `SELECT COUNT(*) AS cnt FROM events WHERE type = 'loyaltyIncrease'`,
        schema: z.coerce.number(),
      });
      expect(eventCountBefore).toBeGreaterThan(0);

      const insertedId = first.selectValue({
        sql: `
          SELECT id FROM events
          WHERE type = 'loyaltyIncrease' AND village_id = $villageId
          ORDER BY id DESC LIMIT 1
        `,
        bind: { $villageId: villageId! },
        schema: z.coerce.number(),
      });
      expect(insertedId).toBeTypeOf('number');

      first.close();

      const second = await openMysqlHostDatabase({
        config: testConfig,
        server,
        seedIfEmpty: true,
      });

      const eventCountAfter = second.selectValue({
        sql: `
          SELECT COUNT(*) AS cnt FROM events
          WHERE id = $id AND type = 'loyaltyIncrease'
        `,
        bind: { $id: insertedId! },
        schema: z.coerce.number(),
      });
      expect(eventCountAfter).toBe(1);

      // CRUD smoke: update + delete
      second.exec({
        sql: `UPDATE events SET duration = 120000 WHERE id = $id`,
        bind: { $id: insertedId! },
      });
      const duration = second.selectValue({
        sql: `SELECT duration FROM events WHERE id = $id`,
        bind: { $id: insertedId! },
        schema: z.coerce.number(),
      });
      expect(duration).toBe(120_000);

      second.exec({
        sql: `DELETE FROM events WHERE id = $id`,
        bind: { $id: insertedId! },
      });
      const gone = second.selectValue({
        sql: `SELECT COUNT(*) AS cnt FROM events WHERE id = $id`,
        bind: { $id: insertedId! },
        schema: z.coerce.number(),
      });
      expect(gone).toBe(0);

      second.close();
    } finally {
      const cleanup = await mysql.createConnection({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        multipleStatements: true,
      });
      await cleanup.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await cleanup.end();
    }
  }, 300_000);
});
