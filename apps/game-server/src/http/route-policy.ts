/**
 * Online route policy (architecture decisions):
 * - Developer tools stay offline-only
 * - Combat simulator is available online, admin-gated
 */
export const isDeveloperToolsPath = (path: string): boolean =>
  path === '/developer-settings' ||
  path.startsWith('/developer-settings/') ||
  path.startsWith('/developer/');

export const isCombatSimulatorPath = (path: string): boolean =>
  path === '/combat-simulator';

/**
 * Online ignores client-supplied startsAt / duration on event create bodies.
 * Server clock + resolver duration helpers remain authoritative.
 */
export const stripClientScheduleFields = (body: unknown): unknown => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return body;
  }

  const next = { ...body } as Record<string, unknown>;
  delete next.startsAt;
  delete next.duration;
  return next;
};
