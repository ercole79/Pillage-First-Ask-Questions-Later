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
import {
  createWorldRuntime,
  type WorldRuntime,
} from './world/world-runtime.ts';

const readBearerFromUrl = (requestUrl: string): string | null => {
  try {
    const url = new URL(requestUrl, 'http://localhost');
    const token = url.searchParams.get('token');
    return token ? `Bearer ${token}` : null;
  } catch {
    return null;
  }
};

const failStartup = (message: string): never => {
  console.error(`[game-server] FATAL: ${message}`);
  console.error(
    '[game-server] Online mode requires a reachable MySQL database (no SQLite/WASM fallback). Fix MYSQL_* settings and retry.',
  );
  process.exit(1);
};

const connectMysql = async (config: ReturnType<typeof getConfig>) => {
  const mysql = MysqlAdapter.fromConfig(config);
  try {
    const status = await mysql.healthCheck();
    if (!status.reachable) {
      await mysql.close().catch(() => undefined);
      failStartup(
        `MySQL unreachable (${status.detail ?? 'unknown error'}). game-server will not start without an authoritative MySQL store.`,
      );
    }
    await mysql.ensureMetaSchema();
    console.error(
      `[game-server] MySQL connected (${status.database}); meta schema ready`,
    );
    return mysql;
  } catch (error) {
    await mysql.close().catch(() => undefined);
    const detail = error instanceof Error ? error.message : String(error);
    failStartup(`MySQL connection failed: ${detail}`);
  }
};

const start = async (): Promise<void> => {
  const config = getConfig();
  const mysqlConfig = {
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
  };

  const mysql = await connectMysql(config);

  const worldServer = {
    ...serverMock,
    id: globalThis.crypto.randomUUID(),
    slug: `online-${serverMock.slug}`,
    name: `Online ${serverMock.name}`,
  };

  let world: WorldRuntime;
  try {
    world = await createWorldRuntime({
      server: worldServer,
      mysql: mysqlConfig,
    });
  } catch (error) {
    await mysql.close().catch(() => undefined);
    const detail = error instanceof Error ? error.message : String(error);
    failStartup(`Game MySQL DbFacade failed to open: ${detail}`);
  }

  console.error(
    '[game-server] game DB backend: mysql (authoritative; game tables alongside online_*)',
  );

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

  const app = createApp({
    config,
    world,
    mysql,
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
    await mysql.close();
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

void start().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  failStartup(detail);
});
