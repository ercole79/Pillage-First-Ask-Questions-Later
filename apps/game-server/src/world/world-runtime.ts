import { z } from 'zod';
import {
  cancelScheduling,
  createRequestContext,
  createSchedulerDataSource,
  type HostDatabase,
  initScheduler,
  matchRoute,
  openSeededHostDatabase,
  scheduleNextEvent,
  setNotificationSink,
  setShouldPostNotifications,
} from '@pillage-first/api/host';
import type { Server } from '@pillage-first/types/models/server';
import type { Village } from '@pillage-first/types/models/village';
import type { SessionIdentity } from '../auth/session.ts';
import {
  ForbiddenError,
  requireAdmin,
  UnauthorizedError,
} from '../auth/session.ts';
import {
  isCombatSimulatorPath,
  isDeveloperToolsPath,
  stripClientScheduleFields,
} from '../http/route-policy.ts';
import { WebSocketNotifier } from '../ws/notifier.ts';
import { WorldSerialQueue } from './serial-queue.ts';

export type WorldHttpRequest = {
  readonly method: string;
  readonly pathWithQuery: string;
  readonly body?: unknown;
  readonly session: SessionIdentity;
};

export type WorldHttpResponse =
  | { readonly ok: true; readonly data: unknown }
  | {
      readonly ok: false;
      readonly status: number;
      readonly error: string;
    };

export type WorldRuntime = {
  readonly server: Server;
  readonly database: HostDatabase;
  readonly queue: WorldSerialQueue;
  readonly notifier: WebSocketNotifier;
  handleHttp: (request: WorldHttpRequest) => Promise<WorldHttpResponse>;
  getPlayerVillageIds: (playerId: number) => Village['id'][];
  stop: () => void;
};

const villageIdSchema = z.number();

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const createWorldRuntime = async (
  server: Server,
): Promise<WorldRuntime> => {
  const database = await openSeededHostDatabase(server);
  const queue = new WorldSerialQueue();
  const notifier = new WebSocketNotifier();

  setNotificationSink(notifier);
  setShouldPostNotifications(true);

  const dataSource = createSchedulerDataSource(database);
  const queuedDataSource = {
    getPastEventIds: dataSource.getPastEventIds,
    getNextEvent: dataSource.getNextEvent,
    resolveEvent: (id: number) => {
      queue.runSync(() => {
        dataSource.resolveEvent(id);
      });
    },
    resolveEvents: (ids: Iterable<number>) => {
      queue.runSync(() => {
        dataSource.resolveEvents(ids);
      });
    },
  };

  initScheduler(queuedDataSource);
  scheduleNextEvent(queuedDataSource);

  return {
    server,
    database,
    queue,
    notifier,
    getPlayerVillageIds: (playerId: number) =>
      database.selectValues({
        sql: `
          SELECT id
          FROM villages
          WHERE player_id = $playerId
          ORDER BY id;
        `,
        bind: { $playerId: playerId },
        schema: villageIdSchema,
      }),
    handleHttp: async (request) => {
      return queue.run(() => {
        try {
          const pathOnly = request.pathWithQuery.split('?')[0] ?? '';

          if (isDeveloperToolsPath(pathOnly)) {
            throw new ForbiddenError(
              'Developer tools are offline-only on the game server',
            );
          }

          if (isCombatSimulatorPath(pathOnly)) {
            requireAdmin(request.session);
          }

          const body = stripClientScheduleFields(request.body);
          const context = createRequestContext({
            playerId: request.session.playerId,
          });

          const matched = matchRoute(
            request.pathWithQuery,
            request.method,
            body,
            context,
          );

          const data = matched.controller(database, {
            context: matched.context,
            path: matched.path,
            query: matched.query,
            body: matched.body as never,
            url: matched.url,
          });

          return { ok: true as const, data };
        } catch (error) {
          if (error instanceof UnauthorizedError) {
            return {
              ok: false as const,
              status: 401,
              error: toErrorMessage(error),
            };
          }

          if (error instanceof ForbiddenError) {
            return {
              ok: false as const,
              status: 403,
              error: toErrorMessage(error),
            };
          }

          return {
            ok: false as const,
            status: 400,
            error: toErrorMessage(error),
          };
        }
      });
    },
    stop: () => {
      cancelScheduling();
      setShouldPostNotifications(false);
      setNotificationSink(null);
      database.close();
    },
  };
};
