import { type Server, serverSchema } from '@pillage-first/types/models/server';
import { createRemoteFetcher } from 'app/(game)/providers/utils/remote-fetch';
import { normalizeRemoteBaseUrl } from 'app/(game)/utils/connection-settings';

export type ProbeRemoteGameServerResult = {
  server: Server;
  firstVillageId: number;
};

export const probeRemoteGameServer = async (
  baseUrl: string,
  authToken: string,
): Promise<ProbeRemoteGameServerResult> => {
  const normalizedBaseUrl = normalizeRemoteBaseUrl(baseUrl);
  const token = authToken.trim();

  if (!normalizedBaseUrl) {
    throw new Error('Server URL is required');
  }

  if (!token) {
    throw new Error('Auth token is required');
  }

  const healthResponse = await fetch(`${normalizedBaseUrl}/health`);

  if (!healthResponse.ok) {
    throw new Error(
      `Game server health check failed (${healthResponse.status})`,
    );
  }

  const fetcher = createRemoteFetcher({
    baseUrl: normalizedBaseUrl,
    authToken: token,
  });

  const { data: serverData } = await fetcher('/server', { method: 'GET' });
  const server = serverSchema.parse(serverData);

  const { data: villagesData } = await fetcher('/me/villages', {
    method: 'GET',
  });

  const firstVillageId =
    Array.isArray(villagesData) &&
    villagesData.length > 0 &&
    typeof villagesData[0] === 'object' &&
    villagesData[0] !== null &&
    'id' in villagesData[0] &&
    typeof (villagesData[0] as { id: unknown }).id === 'number'
      ? (villagesData[0] as { id: number }).id
      : 1;

  return {
    server,
    firstVillageId,
  };
};
