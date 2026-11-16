import { describe, expect, test } from 'vitest';
import { openHostDatabase } from '@pillage-first/api/host';
import { serverMock } from '@pillage-first/mocks/server';
import { getConfig } from '../config.ts';
import { createWorldRuntime } from '../world/world-runtime.ts';

describe('MySQL required for online', () => {
  test('getConfig defaults MYSQL_REQUIRED to true', () => {
    const config = getConfig({});
    expect(config.mysql.required).toBe(true);
  });

  test('openHostDatabase rejects missing mysql config', async () => {
    await expect(
      // @ts-expect-error intentional: online must not open without MySQL
      openHostDatabase({
        server: {
          ...serverMock,
          id: globalThis.crypto.randomUUID(),
        },
      }),
    ).rejects.toThrow(/requires MySQL/i);
  });

  test('createWorldRuntime rejects missing mysql config', async () => {
    await expect(
      // @ts-expect-error intentional: online must not open without MySQL
      createWorldRuntime({
        server: {
          ...serverMock,
          id: globalThis.crypto.randomUUID(),
        },
      }),
    ).rejects.toThrow(/requires MySQL/i);
  });
});
