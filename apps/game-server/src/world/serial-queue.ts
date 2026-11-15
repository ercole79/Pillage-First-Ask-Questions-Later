/**
 * Per-world serial queue for authoritative mutations/resolves.
 *
 * Scaffold note: game controllers + SQLite WASM DbFacade are synchronous, so
 * the queue mainly orders async HTTP entry points and future MySQL awaits.
 * Scheduler resolve callbacks remain sync on the Node event loop; wrap them
 * via `runSync` when calling into shared world state.
 */
export class WorldSerialQueue {
  private chain: Promise<void> = Promise.resolve();
  private syncDepth = 0;

  async run<T>(fn: () => T | Promise<T>): Promise<T> {
    let settle!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const result = new Promise<T>((resolve, rejectPromise) => {
      settle = resolve;
      reject = rejectPromise;
    });

    this.chain = this.chain.then(async () => {
      try {
        settle(await fn());
      } catch (error) {
        reject(error);
      }
    });

    // Keep the chain alive even when the task fails.
    this.chain = this.chain.catch(() => undefined);

    return result;
  }

  runSync<T>(fn: () => T): T {
    this.syncDepth += 1;
    try {
      return fn();
    } finally {
      this.syncDepth -= 1;
    }
  }

  get isRunningSync(): boolean {
    return this.syncDepth > 0;
  }
}
