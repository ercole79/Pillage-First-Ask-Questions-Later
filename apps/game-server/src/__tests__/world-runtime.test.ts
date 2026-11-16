import { afterEach, describe, expect, test } from 'vitest';
import {
  cancelScheduling,
  resetSchedulerForTesting,
} from '@pillage-first/api/host';
import { PLAYER_ID } from '@pillage-first/game-assets/player';
import { serverMock } from '@pillage-first/mocks/server';
import {
  canReachMysql,
  getTestMysqlConfig,
} from '../test-utils/mysql-config.ts';
import { createWorldRuntime } from '../world/world-runtime.ts';

describe('world runtime', () => {
  afterEach(() => {
    cancelScheduling();
    resetSchedulerForTesting();
  });

  test('serves api-routes with session playerId and blocks developer tools', async () => {
    if (!(await canReachMysql())) {
      throw new Error(
        'MySQL is required for game-server tests (no SQLite fallback). Start MySQL or set MYSQL_*.',
      );
    }

    const mysql = getTestMysqlConfig();
    const databaseName = `pillage_runtime_test_${Date.now()}`;
    const mysqlLib = await import('mysql2/promise');
    const admin = await mysqlLib.createConnection({
      host: mysql.host,
      port: mysql.port,
      user: mysql.user,
      password: mysql.password,
      multipleStatements: true,
    });
    await admin.query(
      `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    await admin.end();

    const world = await createWorldRuntime({
      server: {
        ...serverMock,
        id: globalThis.crypto.randomUUID(),
        slug: `runtime-${serverMock.slug}`,
      },
      mysql: { ...mysql, database: databaseName },
    });

    try {
      expect(world.backend).toBe('mysql');
      expect(world.database.dialect).toBe('mysql');

      const villages = await world.handleHttp({
        method: 'GET',
        pathWithQuery: '/me/villages',
        session: {
          token: 'dev-token',
          playerId: PLAYER_ID,
          isAdmin: false,
        },
      });

      expect(villages.ok).toBe(true);
      if (villages.ok) {
        expect(Array.isArray(villages.data)).toBe(true);
        expect((villages.data as unknown[]).length).toBeGreaterThan(0);
      }

      const developerTools = await world.handleHttp({
        method: 'GET',
        pathWithQuery: '/developer-settings',
        session: {
          token: 'dev-token',
          playerId: PLAYER_ID,
          isAdmin: true,
        },
      });

      expect(developerTools).toStrictEqual({
        ok: false,
        status: 403,
        error: 'Developer tools are offline-only on the game server',
      });
    } finally {
      world.stop();
      const cleanup = await mysqlLib.createConnection({
        host: mysql.host,
        port: mysql.port,
        user: mysql.user,
        password: mysql.password,
        multipleStatements: true,
      });
      await cleanup.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await cleanup.end();
    }
  }, 300_000);
});
