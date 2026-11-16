import { useSuspenseQuery } from '@tanstack/react-query';
import type { Server } from '@pillage-first/types/models/server';
import {
  type ApiWorkerHandle,
  getApiWorkerHandle,
} from 'app/(game)/providers/utils/api-worker-manager';
import {
  getRemoteApiHandle,
  type RemoteApiHandle,
} from 'app/(game)/providers/utils/remote-api-manager';
import {
  createWorkerFetcher,
  type Fetcher,
} from 'app/(game)/providers/utils/worker-fetch';
import {
  getConnectionSettings,
  type RemoteConnectionSettings,
} from 'app/(game)/utils/connection-settings';
import { wait } from 'app/utils/device';

export type ApiTransportHandle = (ApiWorkerHandle | RemoteApiHandle) & {
  fetcher: Fetcher;
  mode: 'local' | 'remote';
};

const toLocalTransportHandle = (
  handle: ApiWorkerHandle,
): ApiTransportHandle => {
  return {
    ...handle,
    mode: 'local',
    fetcher: createWorkerFetcher(handle.apiWorker),
  };
};

const toRemoteTransportHandle = (
  handle: RemoteApiHandle,
): ApiTransportHandle => {
  return handle;
};

export const useApiWorker = (serverSlug: Server['slug']) => {
  const { data: apiWorkerHandle } = useSuspenseQuery({
    queryKey: ['api-worker', serverSlug],
    queryFn: async () => {
      const connectionSettings = getConnectionSettings(serverSlug);

      const [apiWorkerHandle] = await Promise.all([
        connectionSettings?.mode === 'remote'
          ? getRemoteApiHandle(
              serverSlug,
              connectionSettings as RemoteConnectionSettings,
            ).then(toRemoteTransportHandle)
          : getApiWorkerHandle(serverSlug).then(toLocalTransportHandle),
        // Minimal splash duration
        wait(1200),
      ]);

      return apiWorkerHandle;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });

  return apiWorkerHandle;
};
