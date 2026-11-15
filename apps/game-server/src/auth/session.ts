import type { Player } from '@pillage-first/types/models/player';
import type { GameServerConfig } from '../config.ts';

export type SessionIdentity = {
  readonly token: string;
  readonly playerId: Player['id'];
  readonly isAdmin: boolean;
};

export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Minimal auth stub: Bearer token → playerId.
 * Sufficient for multi-player later (swap map for real sessions / MySQL).
 * One account = one character (playerId) per world.
 */
export const resolveSessionFromAuthorizationHeader = (
  config: GameServerConfig,
  authorizationHeader: string | null | undefined,
): SessionIdentity => {
  if (!authorizationHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing Bearer token');
  }

  const token = authorizationHeader.slice('Bearer '.length).trim();

  if (!token) {
    throw new UnauthorizedError('Empty Bearer token');
  }

  const playerId = config.authTokenPlayerMap[token];

  if (playerId === undefined) {
    throw new UnauthorizedError('Unknown session token');
  }

  return {
    token,
    playerId,
    isAdmin: config.authAdminTokens.includes(token),
  };
};

export const requireAdmin = (session: SessionIdentity): void => {
  if (!session.isAdmin) {
    throw new ForbiddenError('Admin session required');
  }
};
