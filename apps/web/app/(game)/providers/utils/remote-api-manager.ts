import type { Server } from '@pillage-first/types/models/server';
import { createRemoteFetcher } from 'app/(game)/providers/utils/remote-fetch';
import type { Fetcher } from 'app/(game)/providers/utils/worker-fetch';
import {
  type RemoteConnectionSettings,
  toWebSocketUrl,
} from 'app/(game)/utils/connection-settings';

type NotificationListener = (event: MessageEvent) => void;

export type RemoteApiHandle = {
  apiWorker: null;
  mode: 'remote';
  fetcher: Fetcher;
  closeApiWorker: () => Promise<void>;
  subscribeToApiWorkerNotifications: (
    listener: NotificationListener,
  ) => () => void;
};

const remoteApiHandles = new Map<Server['slug'], Promise<RemoteApiHandle>>();

const createMessageEvent = (data: unknown): MessageEvent => {
  return new MessageEvent('message', { data });
};

const createRemoteApiHandle = (
  serverSlug: Server['slug'],
  settings: RemoteConnectionSettings,
  socket: WebSocket,
): RemoteApiHandle => {
  const listeners = new Set<NotificationListener>();
  let isClosed = false;

  const dispatch = (event: MessageEvent) => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  const onSocketMessage = (event: MessageEvent) => {
    try {
      const data =
        typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      dispatch(createMessageEvent(data));
    } catch (error) {
      console.error('Failed to parse remote WebSocket notification', error);
    }
  };

  socket.addEventListener('message', onSocketMessage);

  const subscribeToApiWorkerNotifications = (
    listener: NotificationListener,
  ) => {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  };

  const closeApiWorker = async () => {
    if (isClosed) {
      return;
    }

    isClosed = true;
    listeners.clear();
    socket.removeEventListener('message', onSocketMessage);

    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socket.close();
    }

    remoteApiHandles.delete(serverSlug);
  };

  return {
    apiWorker: null,
    mode: 'remote',
    fetcher: createRemoteFetcher({
      baseUrl: settings.baseUrl,
      authToken: settings.authToken,
    }),
    closeApiWorker,
    subscribeToApiWorkerNotifications,
  };
};

const waitForWebSocketOpen = (socket: WebSocket): Promise<void> => {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out connecting to remote game-server WebSocket'));
    }, 10_000);

    const onOpen = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error('Failed to connect to remote game-server WebSocket'));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('error', onError);
    };

    socket.addEventListener('open', onOpen);
    socket.addEventListener('error', onError);
  });
};

const createRemoteHandleWithReadySignal = async (
  serverSlug: Server['slug'],
  settings: RemoteConnectionSettings,
): Promise<RemoteApiHandle> => {
  const socket = new WebSocket(
    toWebSocketUrl(settings.baseUrl, settings.authToken),
  );

  try {
    await waitForWebSocketOpen(socket);

    // Confirm HTTP auth works before handing the transport to the UI.
    const fetcher = createRemoteFetcher({
      baseUrl: settings.baseUrl,
      authToken: settings.authToken,
    });
    await fetcher('/server', { method: 'GET' });

    return createRemoteApiHandle(serverSlug, settings, socket);
  } catch (error) {
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socket.close();
    }
    throw error;
  }
};

export const getRemoteApiHandle = async (
  serverSlug: Server['slug'],
  settings: RemoteConnectionSettings,
): Promise<RemoteApiHandle> => {
  const existingHandle = remoteApiHandles.get(serverSlug);

  if (existingHandle !== undefined) {
    return existingHandle;
  }

  const handle = createRemoteHandleWithReadySignal(serverSlug, settings).catch(
    (error) => {
      remoteApiHandles.delete(serverSlug);
      throw error;
    },
  );

  remoteApiHandles.set(serverSlug, handle);

  return handle;
};

export const closeAllRemoteApiHandles = async (): Promise<void> => {
  const handles = [...remoteApiHandles.values()];

  await Promise.allSettled(
    handles.map(async (handle) => {
      const { closeApiWorker } = await handle;
      await closeApiWorker();
    }),
  );
};
