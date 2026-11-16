import { describe, expect, test } from 'vitest';
import { PLAYER_ID } from '@pillage-first/game-assets/player';
import { createRequestContext } from '../request-context';

describe(createRequestContext, () => {
  test('defaults to the offline PLAYER_ID', () => {
    expect(createRequestContext()).toStrictEqual({ playerId: PLAYER_ID });
  });

  test('accepts a session-resolved player id for online hosts', () => {
    expect(createRequestContext({ playerId: 42 })).toStrictEqual({
      playerId: 42,
    });
  });
});
