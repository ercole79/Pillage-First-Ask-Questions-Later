import { describe, expect, test } from 'vitest';
import { WorldSerialQueue } from '../world/serial-queue.ts';

describe(WorldSerialQueue, () => {
  test('runs async tasks in submission order', async () => {
    const queue = new WorldSerialQueue();
    const order: number[] = [];

    const first = queue.run(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push(1);
      return 'a';
    });
    const second = queue.run(async () => {
      order.push(2);
      return 'b';
    });

    await expect(Promise.all([first, second])).resolves.toStrictEqual([
      'a',
      'b',
    ]);
    expect(order).toStrictEqual([1, 2]);
  });

  test('runSync is reentrant for scheduler callbacks', () => {
    const queue = new WorldSerialQueue();
    const values: number[] = [];

    queue.runSync(() => {
      values.push(1);
      queue.runSync(() => {
        values.push(2);
      });
      values.push(3);
    });

    expect(values).toStrictEqual([1, 2, 3]);
  });
});
