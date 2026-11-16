// @vitest-environment happy-dom

import { afterEach, expect, test } from 'vitest';
import {
  connectionSettingsCacheKey,
  DEFAULT_REMOTE_AUTH_TOKEN,
  DEFAULT_REMOTE_GAME_SERVER_URL,
  getConnectionSettings,
  getRemoteConnectionFormDefaults,
  isRemoteConnection,
  normalizeRemoteBaseUrl,
  readConnectionSettingsMap,
  removeConnectionSettings,
  setLocalConnectionSettings,
  setRemoteConnectionFormDefaults,
  setRemoteConnectionSettings,
  toWebSocketUrl,
} from 'app/(game)/utils/connection-settings';

afterEach(() => {
  window.localStorage.clear();
});

test('normalizeRemoteBaseUrl strips trailing slashes', () => {
  expect(normalizeRemoteBaseUrl('http://127.0.0.1:3010/')).toBe(
    'http://127.0.0.1:3010',
  );
  expect(normalizeRemoteBaseUrl('http://127.0.0.1:3010///')).toBe(
    'http://127.0.0.1:3010',
  );
});

test('toWebSocketUrl builds ws URL with token query', () => {
  expect(toWebSocketUrl('http://127.0.0.1:3010', 'dev-token')).toBe(
    'ws://127.0.0.1:3010/ws?token=dev-token',
  );
  expect(toWebSocketUrl('https://game.example.com/', 'secret')).toBe(
    'wss://game.example.com/ws?token=secret',
  );
});

test('persists remote and local connection settings by slug', () => {
  setRemoteConnectionSettings('online-abc', {
    baseUrl: 'http://127.0.0.1:3010/',
    authToken: 'dev-token',
  });
  setLocalConnectionSettings('s-local');

  expect(getConnectionSettings('online-abc')).toEqual({
    mode: 'remote',
    baseUrl: 'http://127.0.0.1:3010',
    authToken: 'dev-token',
  });
  expect(isRemoteConnection('online-abc')).toBe(true);
  expect(getConnectionSettings('s-local')).toEqual({ mode: 'local' });
  expect(isRemoteConnection('s-local')).toBe(false);

  const raw = window.localStorage.getItem(connectionSettingsCacheKey);
  expect(raw).toContain('online-abc');

  removeConnectionSettings('online-abc');
  expect(getConnectionSettings('online-abc')).toBeNull();
  expect(readConnectionSettingsMap()).toEqual({
    's-local': { mode: 'local' },
  });
});

test('remote form defaults fall back to local game-server values', () => {
  expect(getRemoteConnectionFormDefaults()).toEqual({
    baseUrl: DEFAULT_REMOTE_GAME_SERVER_URL,
    authToken: DEFAULT_REMOTE_AUTH_TOKEN,
  });

  setRemoteConnectionFormDefaults({
    baseUrl: 'http://localhost:4010/',
    authToken: 'custom-token',
  });

  expect(getRemoteConnectionFormDefaults()).toEqual({
    baseUrl: 'http://localhost:4010',
    authToken: 'custom-token',
  });
});
