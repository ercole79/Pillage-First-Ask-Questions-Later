import { afterEach, expect, test, vi } from 'vitest';
import { createRemoteFetcher } from 'app/(game)/providers/utils/remote-fetch';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('createRemoteFetcher prefixes /api and sends bearer auth', async () => {
  const fetchMock = vi.fn(async () => {
    return new Response(JSON.stringify({ id: 'server-1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);

  const fetcher = createRemoteFetcher({
    baseUrl: 'http://127.0.0.1:3010',
    authToken: 'dev-token',
  });

  const result = await fetcher('/server', { method: 'GET' });

  expect(result).toEqual({ data: { id: 'server-1' } });
  expect(fetchMock).toHaveBeenCalledOnce();

  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe('http://127.0.0.1:3010/api/server');
  expect(init).toMatchObject({
    method: 'GET',
  });
  expect(new Headers(init?.headers).get('Authorization')).toBe(
    'Bearer dev-token',
  );
});

test('createRemoteFetcher JSON-encodes bodies and surfaces API errors', async () => {
  const fetchMock = vi.fn(async () => {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);

  const fetcher = createRemoteFetcher({
    baseUrl: 'http://127.0.0.1:3010/',
    authToken: 'bad-token',
  });

  await expect(
    fetcher('/me/villages', {
      method: 'POST',
      body: { hello: 'world' },
    }),
  ).rejects.toThrow('Unauthorized');

  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe('http://127.0.0.1:3010/api/me/villages');
  expect(init?.body).toBe(JSON.stringify({ hello: 'world' }));
  expect(new Headers(init?.headers).get('Content-Type')).toBe(
    'application/json',
  );
});

test('createRemoteFetcher returns undefined data for 204', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 204 })),
  );

  const fetcher = createRemoteFetcher({
    baseUrl: 'http://127.0.0.1:3010',
    authToken: 'dev-token',
  });

  await expect(fetcher('/events/1', { method: 'DELETE' })).resolves.toEqual({
    data: undefined,
  });
});
