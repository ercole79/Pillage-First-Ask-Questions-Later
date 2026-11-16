import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  resolveSessionFromAuthorizationHeader,
  type SessionIdentity,
  UnauthorizedError,
} from './auth/session.ts';
import type { GameServerConfig } from './config.ts';
import type { MysqlAdapter } from './persistence/mysql-adapter.ts';
import type { WorldRuntime } from './world/world-runtime.ts';

export type CreateAppOptions = {
  readonly config: GameServerConfig;
  readonly world: WorldRuntime;
  readonly mysql: MysqlAdapter;
};

const apiPathWithQuery = (request: Request, path: string): string => {
  const url = new URL(request.url);
  const stripped = path.replace(/^\/api/, '') || '/';
  return `${stripped}${url.search}`;
};

export const createApp = ({
  config,
  world,
  mysql,
}: CreateAppOptions): Hono => {
  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: (origin) => {
        if (config.corsOrigins.length === 0) {
          return origin || '*';
        }

        return config.corsOrigins.includes(origin) ? origin : '';
      },
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  app.get('/health', async (c) => {
    const mysqlStatus = await mysql.healthCheck();

    return c.json({
      ok: true,
      mode: 'online',
      world: {
        slug: world.server.slug,
        name: world.server.name,
      },
      gameDb: {
        backend: world.backend,
        dialect: world.database.dialect,
      },
      mysql: mysqlStatus,
      scheduler: 'running',
    });
  });

  app.get('/me', (c) => {
    try {
      const session = resolveSessionFromAuthorizationHeader(
        config,
        c.req.header('authorization'),
      );

      return c.json({
        playerId: session.playerId,
        isAdmin: session.isAdmin,
        villageIds: world.getPlayerVillageIds(session.playerId),
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return c.json({ error: error.message }, 401);
      }

      return c.json({ error: 'Unable to resolve session' }, 500);
    }
  });

  app.all('/api/*', async (c) => {
    let session: SessionIdentity;
    try {
      session = resolveSessionFromAuthorizationHeader(
        config,
        c.req.header('authorization'),
      );
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return c.json({ error: error.message }, 401);
      }

      return c.json({ error: 'Unable to resolve session' }, 500);
    }

    let body: unknown;
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const contentType = c.req.header('content-type') ?? '';
      if (contentType.includes('application/json')) {
        body = await c.req.json();
      }
    }

    const result = await world.handleHttp({
      method: c.req.method,
      pathWithQuery: apiPathWithQuery(c.req.raw, c.req.path),
      body,
      session,
    });

    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 400);
    }

    if (result.data === undefined) {
      return c.body(null, 204);
    }

    return c.json(result.data);
  });

  return app;
};
