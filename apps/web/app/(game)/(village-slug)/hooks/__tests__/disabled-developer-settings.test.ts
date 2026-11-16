import { expect, test } from 'vitest';
import { disabledDeveloperSettings } from 'app/(game)/(village-slug)/hooks/use-developer-settings';

test('disabledDeveloperSettings keeps every toggle off for online mode', () => {
  expect(
    Object.values(disabledDeveloperSettings).every((value) => value === false),
  ).toBe(true);
  expect(disabledDeveloperSettings).toMatchObject({
    isInstantBuildingConstructionEnabled: false,
    isFreeBuildingConstructionEnabled: false,
    isFreeCelebrationsEnabled: false,
    isInstantCelebrationsEnabled: false,
  });
});
