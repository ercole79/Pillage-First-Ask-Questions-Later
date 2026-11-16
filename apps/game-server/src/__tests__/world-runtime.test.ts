import { afterEach, describe, expect, test } from 'vitest';
import {
  cancelScheduling,
  resetSchedulerForTesting,
} from '@pillage-first/api/host';
import { PLAYER_ID } from '@pillage-first/game-assets/player';
import { serverMock } from '@pillage-first/mocks/server';
import { createWorldRuntime } from '../world/world-runtime.ts';

describe('world runtime', () => {
  afterEach(() => {
    cancelScheduling();
    resetSchedulerForTesting();
  });

  test('serves api-routes with session playerId and blocks developer tools', async () => {
    const world = await createWorldRuntime({
      server: {
        ...serverMock,
        id: globalThis.crypto.randomUUID(),
        slug: `runtime-${serverMock.slug}`,
      },
      backend: 'sqlite',
    });

    try {
      expect(world.backend).toBe('sqlite');

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
    }
  });
});
