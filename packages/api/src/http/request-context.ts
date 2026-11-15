import { PLAYER_ID } from '@pillage-first/game-assets/player';
import type { Player } from '@pillage-first/types/models/player';

export type RequestContext = {
  readonly playerId: Player['id'];
};

export type CreateRequestContextOptions = {
  readonly playerId?: Player['id'];
};

/**
 * Offline worker default remains `PLAYER_ID`.
 * Online HTTP adapters should pass the session-resolved player id.
 */
export const createRequestContext = (
  options?: CreateRequestContextOptions,
): RequestContext => ({
  playerId: options?.playerId ?? PLAYER_ID,
});
