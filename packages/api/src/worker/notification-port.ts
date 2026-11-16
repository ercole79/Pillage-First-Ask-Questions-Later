export type NotificationSink = {
  post: (message: unknown, options?: { force?: boolean }) => void;
};

let notificationSink: NotificationSink | null = null;
let shouldPostNotifications = false;

/**
 * Pluggable notify sink for offline MessagePort and online WebSocket fan-out.
 * Offline keeps `setNotificationPort`; online hosts call `setNotificationSink`.
 */
export const setNotificationSink = (sink: NotificationSink | null): void => {
  notificationSink = sink;
};

export const setNotificationPort = (port: MessagePort): void => {
  port.start();
  setNotificationSink({
    post: (message) => {
      port.postMessage(message);
    },
  });
};

export const setShouldPostNotifications = (value: boolean): void => {
  shouldPostNotifications = value;
};

export const postWorkerMessage = (
  message: unknown,
  options?: { force?: boolean },
): void => {
  if (!notificationSink) {
    return;
  }

  if (!options?.force && !shouldPostNotifications) {
    return;
  }

  notificationSink.post(message, options);
};
