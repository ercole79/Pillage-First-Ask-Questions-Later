import { describe, expect, test } from 'vitest';
import {
  ForbiddenError,
  requireAdmin,
  resolveSessionFromAuthorizationHeader,
  UnauthorizedError,
} from '../auth/session.ts';
import { getConfig } from '../config.ts';

describe('auth stub', () => {
  const config = getConfig({
    AUTH_TOKEN_PLAYER_MAP: JSON.stringify({ 'player-token': 7 }),
    AUTH_ADMIN_TOKENS: JSON.stringify(['admin-token']),
  });

  test('maps bearer tokens to playerId', () => {
    expect(
      resolveSessionFromAuthorizationHeader(config, 'Bearer player-token'),
    ).toStrictEqual({
      token: 'player-token',
      playerId: 7,
      isAdmin: false,
    });
  });

  test('marks configured admin tokens', () => {
    // admin-token is not in player map by default in this config override
    const withAdminPlayer = getConfig({
      AUTH_TOKEN_PLAYER_MAP: JSON.stringify({ 'admin-token': 1 }),
      AUTH_ADMIN_TOKENS: JSON.stringify(['admin-token']),
    });

    const session = resolveSessionFromAuthorizationHeader(
      withAdminPlayer,
      'Bearer admin-token',
    );
    expect(session.isAdmin).toBe(true);
    expect(() => requireAdmin(session)).not.toThrow();
  });

  test('rejects missing or unknown tokens', () => {
    expect(() =>
      resolveSessionFromAuthorizationHeader(config, null),
    ).toThrowError(UnauthorizedError);
    expect(() =>
      resolveSessionFromAuthorizationHeader(config, 'Bearer nope'),
    ).toThrowError(UnauthorizedError);
  });

  test('requireAdmin rejects non-admin sessions', () => {
    const session = resolveSessionFromAuthorizationHeader(
      config,
      'Bearer player-token',
    );
    expect(() => requireAdmin(session)).toThrowError(ForbiddenError);
  });
});
