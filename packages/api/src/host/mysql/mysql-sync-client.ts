import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

export type MysqlConnectionConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

type WorkerRequest =
  | { type: 'exec'; sql: string; bind?: Record<string, unknown> }
  | { type: 'execMulti'; sql: string; bind?: Record<string, unknown> }
  | { type: 'query'; sql: string; bind?: Record<string, unknown> }
  | { type: 'begin' }
  | { type: 'commit' }
  | { type: 'rollback' }
  | { type: 'ping' }
  | { type: 'close' };

type WorkerResponse =
  | { ok: true; type?: 'ready'; rows?: Record<string, unknown>[] }
  | { ok: false; error: string };

const require = createRequire(import.meta.url);

const RESULT_BUFFER_BYTES = 16 * 1024 * 1024;

const resolveMysql2Root = (): string => {
  const mysqlEntry = require.resolve('mysql2/package.json');
  return path.dirname(mysqlEntry);
};

const resolveWorkerPath = (): string => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.join(here, 'mysql-sync-worker.mjs');
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  throw new Error(`MySQL sync worker not found at ${candidate}`);
};

export class MysqlSyncClient {
  private readonly worker: Worker;
  private readonly control: Int32Array;
  private readonly resultBytes: Uint8Array;
  private closed = false;

  private constructor(
    worker: Worker,
    control: Int32Array,
    resultBytes: Uint8Array,
  ) {
    this.worker = worker;
    this.control = control;
    this.resultBytes = resultBytes;
  }

  static open(config: MysqlConnectionConfig): MysqlSyncClient {
    const workerPath = resolveWorkerPath();
    const mysql2Root = resolveMysql2Root();
    const nodePathParts = [
      path.join(mysql2Root, '..'),
      process.env.NODE_PATH,
    ].filter(Boolean);

    const controlSab = new SharedArrayBuffer(8);
    const resultSab = new SharedArrayBuffer(RESULT_BUFFER_BYTES);
    const control = new Int32Array(controlSab);
    const resultBytes = new Uint8Array(resultSab);

    Atomics.store(control, 0, 0);

    const worker = new Worker(workerPath, {
      workerData: { controlSab, resultSab, config },
      env: {
        ...process.env,
        NODE_PATH: nodePathParts.join(path.delimiter),
      },
    });

    worker.on('error', (error) => {
      console.error('[mysql-sync-client] worker error', error);
    });

    const client = new MysqlSyncClient(worker, control, resultBytes);
    const ready = client.waitForResponse();
    if (!ready.ok) {
      void worker.terminate();
      throw new Error(`MySQL sync worker failed to start: ${ready.error}`);
    }
    return client;
  }

  private waitForResponse(): WorkerResponse {
    const waitResult = Atomics.wait(this.control, 0, 0);
    if (waitResult === 'timed-out') {
      throw new Error('MySQL sync worker timed out');
    }

    const length = this.control[1];
    if (length <= 0 || length > this.resultBytes.length) {
      throw new Error(`Invalid MySQL sync worker response length: ${length}`);
    }

    const json = Buffer.from(
      this.resultBytes.buffer,
      this.resultBytes.byteOffset,
      length,
    ).toString('utf8');

    Atomics.store(this.control, 0, 0);
    return JSON.parse(json) as WorkerResponse;
  }

  private call(message: WorkerRequest): WorkerResponse {
    if (this.closed) {
      throw new Error('MySQL sync client is closed');
    }

    Atomics.store(this.control, 0, 0);
    this.worker.postMessage(message);
    const response = this.waitForResponse();
    if (!response.ok) {
      throw new Error(response.error);
    }
    return response;
  }

  exec(sql: string, bind?: Record<string, unknown>): void {
    this.call({ type: 'exec', sql, bind });
  }

  execMulti(sql: string, bind?: Record<string, unknown>): void {
    this.call({ type: 'execMulti', sql, bind });
  }

  query(sql: string, bind?: Record<string, unknown>): Record<string, unknown>[] {
    const response = this.call({ type: 'query', sql, bind });
    return response.rows ?? [];
  }

  begin(): void {
    this.call({ type: 'begin' });
  }

  commit(): void {
    this.call({ type: 'commit' });
  }

  rollback(): void {
    this.call({ type: 'rollback' });
  }

  ping(): void {
    this.call({ type: 'ping' });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      this.call({ type: 'close' });
    } catch {
      void this.worker.terminate();
    }
  }
}
