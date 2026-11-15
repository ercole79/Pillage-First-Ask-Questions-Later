import { describe, expect, test } from 'vitest';
import { shouldDeliverNotification } from '../ws/notifier.ts';

describe(shouldDeliverNotification, () => {
  test('delivers public-map style notifications without village ids', () => {
    expect(
      shouldDeliverNotification(
        { eventKey: 'event:database-initialization-success' },
        { villageIds: new Set([1]) },
      ),
    ).toBe(true);
  });

  test('delivers only when an affected village is owned', () => {
    expect(
      shouldDeliverNotification(
        {
          eventKey: 'event:success',
          affectedVillageIds: [2, null],
        },
        { villageIds: new Set([1]) },
      ),
    ).toBe(false);

    expect(
      shouldDeliverNotification(
        {
          eventKey: 'event:success',
          affectedVillageIds: [2, null],
        },
        { villageIds: new Set([2]) },
      ),
    ).toBe(true);
  });
});
