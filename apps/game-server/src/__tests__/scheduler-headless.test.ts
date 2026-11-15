import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import {
  cancelScheduling,
  createSchedulerDataSource,
  initScheduler,
  openSeededHostDatabase,
  resetSchedulerForTesting,
  scheduleNextEvent,
  setNotificationSink,
  setShouldPostNotifications,
} from '@pillage-first/api/host';
import { PLAYER_ID } from '@pillage-first/game-assets/player';
import { serverMock } from '@pillage-first/mocks/server';

describe('headless scheduler smoke', () => {
  afterEach(() => {
    cancelScheduling();
    resetSchedulerForTesting();
    setShouldPostNotifications(false);
    setNotificationSink(null);
    vi.useRealTimers();
  });

  test('resolves due events with no client connected', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    const notifications: unknown[] = [];
    setNotificationSink({
      post: (message) => {
        notifications.push(message);
      },
    });
    setShouldPostNotifications(true);

    const database = await openSeededHostDatabase({
      ...serverMock,
      id: globalThis.crypto.randomUUID(),
      slug: `headless-${serverMock.slug}`,
    });

    try {
      const playerVillageCount = database.selectValue({
        sql: `
          SELECT COUNT(*)
          FROM villages
          WHERE player_id = $playerId;
        `,
        bind: { $playerId: PLAYER_ID },
        schema: z.number(),
      });
      expect(playerVillageCount).toBeGreaterThan(0);

      // Past-due loyaltyIncrease — resolvers stay shared; no client required.
      database.exec({
        sql: `
          INSERT INTO events (type, starts_at, duration, village_id, meta)
          VALUES ('loyaltyIncrease', $startsAt, $duration, NULL, NULL);
        `,
        bind: {
          $startsAt: 900_000,
          $duration: 1,
        },
      });

      const dueBefore = database.selectValues({
        sql: `
          SELECT id
          FROM events
          WHERE resolves_at <= $now
          ORDER BY resolves_at, id;
        `,
        bind: { $now: Date.now() },
        schema: z.number(),
      });
      expect(dueBefore.length).toBeGreaterThan(0);

      const dataSource = createSchedulerDataSource(database);
      initScheduler(dataSource);
      scheduleNextEvent(dataSource);

      // Allow kick/timeout microtasks from the scheduler to flush.
      await vi.runAllTimersAsync();

      const dueAfter = database.selectValues({
        sql: `
          SELECT id
          FROM events
          WHERE resolves_at <= $now
          ORDER BY resolves_at, id;
        `,
        bind: { $now: Date.now() },
        schema: z.number(),
      });

      // The past-due loyaltyIncrease should have been consumed (and possibly
      // re-chained with a future resolves_at — still not due).
      expect(dueAfter).not.toContain(dueBefore[0]);
      expect(
        notifications.some(
          (notification) =>
            typeof notification === 'object' &&
            notification !== null &&
            'eventKey' in notification &&
            (notification as { eventKey: string }).eventKey === 'event:success',
        ),
      ).toBe(true);
    } finally {
      database.close();
    }
  });
});
