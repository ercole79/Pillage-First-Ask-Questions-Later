import { createServer } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { type WebSocket, WebSocketServer } from 'ws';
import { serverMock } from '@pillage-first/mocks/server';
import { createApp } from './app.ts';
import {
  resolveSessionFromAuthorizationHeader,
  UnauthorizedError,
} from './auth/session.ts';
import { getConfig } from './config.ts';
import { MysqlAdapter } from './persistence/mysql-adapter.ts';
import { createWorldRuntime } from './world/world-runtime.ts';

const readBearerFromUrl = (requestUrl: string): string | null => {
  try {
    const url = new URL(requestUrl, 'http://localhost');
    const token = url.searchParams.get('token');
    return token ? `Bearer ${token}` : null;
  } catch {
    return null;
  }
};

const start = async (): Promise<void> => {
  const config = getConfig();

  let mysql: MysqlAdapter | null = null;
  let mysqlStatusDetail: string | undefined;

  try {
    mysql = MysqlAdapter.fromConfig(config);
    const status = await mysql.healthCheck();

    if (!status.reachable) {
      mysqlStatusDetail = status.detail ?? 'MySQL unreachable';
      if (config.mysql.required) {
        throw new Error(`MySQL required but unreachable: ${mysqlStatusDetail}`);
      }
      console.error(
        `[game-server] MySQL unreachable (${mysqlStatusDetail}); continuing with in-memory SQLite game kernel fallback`,
      );
      await mysql.close();
      mysql = null;
    } else {
      await mysql.ensureMetaSchema();
      console.error(
        `[game-server] MySQL connected (${status.database}); meta schema ready`,
      );
    }
  } catch (error) {
    if (config.mysql.required) {
      throw error;
    }
    mysqlStatusDetail = error instanceof Error ? error.message : String(error);
    console.error(`[game-server] MySQL adapter skipped: ${mysqlStatusDetail}`);
    if (mysql) {
      await mysql.close().catch(() => undefined);
      mysql = null;
    }
  }

  const worldServer = {
    ...serverMock,
    id: globalThis.crypto.randomUUID(),
    slug: `online-${serverMock.slug}`,
    name: `Online ${serverMock.name}`,
  };

  const world = await createWorldRuntime({
    server: worldServer,
    mysql: mysql
      ? {
          host: config.mysql.host,
          port: config.mysql.port,
          user: config.mysql.user,
          password: config.mysql.password,
          database: config.mysql.database,
        }
      : undefined,
    backend: mysql ? 'mysql' : 'sqlite',
  });

  console.error(
    `[game-server] game DB backend: ${world.backend}${
      world.backend === 'sqlite'
        ? ' (in-memory fallback; set MYSQL_* and ensure MySQL is reachable for persistence)'
        : ' (MySQL — game tables alongside online_*)'
    }`,
  );

  if (mysql) {
    await mysql
      .upsertStubCharacter({
        worldSlug: world.server.slug,
        worldName: world.server.name,
        accountExternalId: 'dev-account',
        playerId: 1,
      })
      .catch((error) => {
        console.error('[game-server] Failed to upsert stub character', error);
      });
  }

  const app = createApp({
    config,
    world,
    mysql,
    mysqlStatusDetail,
  });

  const server = createServer(getRequestListener(app.fetch));
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket: WebSocket, request) => {
    try {
      const authorization =
        request.headers.authorization ?? readBearerFromUrl(request.url ?? '');
      const session = resolveSessionFromAuthorizationHeader(
        config,
        authorization,
      );
      const villageIds = new Set(world.getPlayerVillageIds(session.playerId));
      const unsubscribe = world.notifier.subscribe({
        playerId: session.playerId,
        villageIds,
        socket,
      });

      socket.send(
        JSON.stringify({
          eventKey: 'event:database-initialization-success',
          playerId: session.playerId,
          villageIds: [...villageIds],
        }),
      );

      socket.on('close', () => {
        unsubscribe();
      });
    } catch (error) {
      const message =
        error instanceof UnauthorizedError
          ? error.message
          : 'Unable to authorize WebSocket';
      socket.send(JSON.stringify({ eventKey: 'event:error', error: message }));
      socket.close();
    }
  });

  server.listen(config.port, () => {
    console.error(
      `[game-server] listening on http://127.0.0.1:${config.port} (ws /ws)`,
    );
  });

  const shutdown = async () => {
    console.error('[game-server] shutting down');
    wss.close();
    world.stop();
    if (mysql) {
      await mysql.close();
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  };

  process.on('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });
};

void start();
