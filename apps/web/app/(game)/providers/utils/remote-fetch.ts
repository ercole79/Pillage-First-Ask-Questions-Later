import type { Fetcher } from 'app/(game)/providers/utils/worker-fetch';

export type RemoteFetcherOptions = {
  baseUrl: string;
  authToken: string;
};

const buildApiUrl = (baseUrl: string, pathWithQuery: string): string => {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const path = pathWithQuery.startsWith('/')
    ? pathWithQuery
    : `/${pathWithQuery}`;
  return `${normalizedBase}/api${path}`;
};

export const createRemoteFetcher = ({
  baseUrl,
  authToken,
}: RemoteFetcherOptions): Fetcher => {
  return async (url, init) => {
    const method = init?.method ?? 'GET';
    const headers = new Headers({
      Authorization: `Bearer ${authToken}`,
    });

    let body: BodyInit | undefined;

    if (
      init?.body !== undefined &&
      init.body !== null &&
      method !== 'GET' &&
      method !== 'HEAD'
    ) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(init.body);
    }

    const response = await fetch(buildApiUrl(baseUrl, url), {
      method,
      headers,
      body,
    });

    if (response.status === 204) {
      return { data: undefined };
    }

    const contentType = response.headers.get('content-type') ?? '';
    const isJson = contentType.includes('application/json');
    const payload: unknown = isJson
      ? await response.json()
      : await response.arrayBuffer();

    if (!response.ok) {
      const message =
        typeof payload === 'object' &&
        payload !== null &&
        'error' in payload &&
        typeof (payload as { error: unknown }).error === 'string'
          ? (payload as { error: string }).error
          : `Remote API request failed: ${method} ${url} (${response.status})`;

      throw new Error(message);
    }

    return { data: payload };
  };
};
