import type { Server } from '@pillage-first/types/models/server';

export const DEFAULT_REMOTE_GAME_SERVER_URL = 'http://127.0.0.1:3010';
export const DEFAULT_REMOTE_AUTH_TOKEN = 'dev-token';

export const connectionSettingsCacheKey = 'game-connection-settings';
export const remoteConnectionFormDefaultsCacheKey =
  'remote-connection-form-defaults';

export type RemoteConnectionSettings = {
  mode: 'remote';
  baseUrl: string;
  authToken: string;
};

export type LocalConnectionSettings = {
  mode: 'local';
};

export type ConnectionSettings =
  | RemoteConnectionSettings
  | LocalConnectionSettings;

export type ConnectionSettingsMap = Record<Server['slug'], ConnectionSettings>;

export type RemoteConnectionFormDefaults = {
  baseUrl: string;
  authToken: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isRemoteConnectionSettings = (
  value: unknown,
): value is RemoteConnectionSettings => {
  if (!isRecord(value) || value.mode !== 'remote') {
    return false;
  }

  return (
    typeof value.baseUrl === 'string' &&
    value.baseUrl.length > 0 &&
    typeof value.authToken === 'string' &&
    value.authToken.length > 0
  );
};

const isLocalConnectionSettings = (
  value: unknown,
): value is LocalConnectionSettings => {
  return isRecord(value) && value.mode === 'local';
};

const isConnectionSettings = (value: unknown): value is ConnectionSettings =>
  isRemoteConnectionSettings(value) || isLocalConnectionSettings(value);

export const normalizeRemoteBaseUrl = (baseUrl: string): string => {
  return baseUrl.trim().replace(/\/+$/, '');
};

export const toWebSocketUrl = (baseUrl: string, authToken: string): string => {
  const normalized = normalizeRemoteBaseUrl(baseUrl);
  const url = new URL(normalized);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.search = '';
  url.searchParams.set('token', authToken);
  return url.toString();
};

export const readConnectionSettingsMap = (): ConnectionSettingsMap => {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(connectionSettingsCacheKey);
    if (!raw) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return {};
    }

    const map: ConnectionSettingsMap = {};

    for (const [slug, settings] of Object.entries(parsed)) {
      if (isConnectionSettings(settings)) {
        map[slug] = settings;
      }
    }

    return map;
  } catch {
    return {};
  }
};

export const writeConnectionSettingsMap = (
  map: ConnectionSettingsMap,
): void => {
  window.localStorage.setItem(connectionSettingsCacheKey, JSON.stringify(map));
};

export const getConnectionSettings = (
  serverSlug: Server['slug'],
): ConnectionSettings | null => {
  return readConnectionSettingsMap()[serverSlug] ?? null;
};

export const isRemoteConnection = (serverSlug: Server['slug']): boolean => {
  return getConnectionSettings(serverSlug)?.mode === 'remote';
};

export const setLocalConnectionSettings = (
  serverSlug: Server['slug'],
): void => {
  const map = readConnectionSettingsMap();
  map[serverSlug] = { mode: 'local' };
  writeConnectionSettingsMap(map);
};

export const setRemoteConnectionSettings = (
  serverSlug: Server['slug'],
  settings: Omit<RemoteConnectionSettings, 'mode'>,
): void => {
  const map = readConnectionSettingsMap();
  map[serverSlug] = {
    mode: 'remote',
    baseUrl: normalizeRemoteBaseUrl(settings.baseUrl),
    authToken: settings.authToken.trim(),
  };
  writeConnectionSettingsMap(map);
};

export const removeConnectionSettings = (serverSlug: Server['slug']): void => {
  const map = readConnectionSettingsMap();
  delete map[serverSlug];
  writeConnectionSettingsMap(map);
};

export const getRemoteConnectionFormDefaults =
  (): RemoteConnectionFormDefaults => {
    if (typeof window === 'undefined') {
      return {
        baseUrl: DEFAULT_REMOTE_GAME_SERVER_URL,
        authToken: DEFAULT_REMOTE_AUTH_TOKEN,
      };
    }

    try {
      const raw = window.localStorage.getItem(
        remoteConnectionFormDefaultsCacheKey,
      );
      if (!raw) {
        return {
          baseUrl: DEFAULT_REMOTE_GAME_SERVER_URL,
          authToken: DEFAULT_REMOTE_AUTH_TOKEN,
        };
      }

      const parsed: unknown = JSON.parse(raw);
      if (
        !isRecord(parsed) ||
        typeof parsed.baseUrl !== 'string' ||
        typeof parsed.authToken !== 'string'
      ) {
        return {
          baseUrl: DEFAULT_REMOTE_GAME_SERVER_URL,
          authToken: DEFAULT_REMOTE_AUTH_TOKEN,
        };
      }

      return {
        baseUrl: parsed.baseUrl || DEFAULT_REMOTE_GAME_SERVER_URL,
        authToken: parsed.authToken || DEFAULT_REMOTE_AUTH_TOKEN,
      };
    } catch {
      return {
        baseUrl: DEFAULT_REMOTE_GAME_SERVER_URL,
        authToken: DEFAULT_REMOTE_AUTH_TOKEN,
      };
    }
  };

export const setRemoteConnectionFormDefaults = (
  defaults: RemoteConnectionFormDefaults,
): void => {
  window.localStorage.setItem(
    remoteConnectionFormDefaultsCacheKey,
    JSON.stringify({
      baseUrl: normalizeRemoteBaseUrl(defaults.baseUrl),
      authToken: defaults.authToken.trim(),
    }),
  );
};
