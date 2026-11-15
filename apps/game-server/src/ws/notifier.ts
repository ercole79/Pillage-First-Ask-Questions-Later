import type { WebSocket } from 'ws';
import type { NotificationSink } from '@pillage-first/api/host';
import type { ApiNotificationEvent } from '@pillage-first/types/api-events';
import type { Player } from '@pillage-first/types/models/player';
import type { Village } from '@pillage-first/types/models/village';

type Subscription = {
  readonly playerId: Player['id'];
  readonly villageIds: ReadonlySet<Village['id']>;
  readonly socket: WebSocket;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readAffectedVillageIds = (message: unknown): (number | null)[] | null => {
  if (!isRecord(message) || !('affectedVillageIds' in message)) {
    return null;
  }

  const value = message.affectedVillageIds;

  if (!Array.isArray(value)) {
    return null;
  }

  return value.filter(
    (entry): entry is number | null =>
      entry === null || typeof entry === 'number',
  );
};

/**
 * Public-map relevance: notifications without village scoping (or with a null
 * village id) are treated as public-map fan-out. Village-scoped events only go
 * to subscribers that own one of the affected villages.
 */
export const shouldDeliverNotification = (
  message: unknown,
  subscription: Pick<Subscription, 'villageIds'>,
): boolean => {
  const affectedVillageIds = readAffectedVillageIds(message);

  if (affectedVillageIds === null) {
    return true;
  }

  if (affectedVillageIds.length === 0) {
    return true;
  }

  return affectedVillageIds.some(
    (villageId) => villageId !== null && subscription.villageIds.has(villageId),
  );
};

export class WebSocketNotifier implements NotificationSink {
  private readonly subscriptions = new Set<Subscription>();

  subscribe(subscription: Subscription): () => void {
    this.subscriptions.add(subscription);

    return () => {
      this.subscriptions.delete(subscription);
    };
  }

  post(message: unknown, _options?: { force?: boolean }): void {
    for (const subscription of this.subscriptions) {
      if (subscription.socket.readyState !== subscription.socket.OPEN) {
        continue;
      }

      if (!shouldDeliverNotification(message, subscription)) {
        continue;
      }

      try {
        subscription.socket.send(JSON.stringify(message));
      } catch (error) {
        console.error('Failed to send WebSocket notification', error);
      }
    }
  }

  /** @internal testing helper */
  get subscriberCount(): number {
    return this.subscriptions.size;
  }
}

export type { ApiNotificationEvent };
