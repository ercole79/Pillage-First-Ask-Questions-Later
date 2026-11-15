import { describe, expect, test } from 'vitest';
import {
  isCombatSimulatorPath,
  isDeveloperToolsPath,
  stripClientScheduleFields,
} from '../http/route-policy.ts';

describe('route policy', () => {
  test('classifies developer and combat simulator paths', () => {
    expect(isDeveloperToolsPath('/developer/heroes/1/kill')).toBe(true);
    expect(isDeveloperToolsPath('/developer-settings')).toBe(true);
    expect(isDeveloperToolsPath('/me/villages')).toBe(false);
    expect(isCombatSimulatorPath('/combat-simulator')).toBe(true);
    expect(isCombatSimulatorPath('/me/villages')).toBe(false);
  });

  test('strips client startsAt and duration for server clock authority', () => {
    expect(
      stripClientScheduleFields({
        type: 'buildingLevelChange',
        startsAt: 123,
        duration: 456,
        villageId: 1,
      }),
    ).toStrictEqual({
      type: 'buildingLevelChange',
      villageId: 1,
    });
  });
});
