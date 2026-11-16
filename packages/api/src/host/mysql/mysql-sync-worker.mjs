/**
 * Worker-thread mysql2 bridge for the sync MySQL DbFacade.
 *
 * Main thread blocks on Atomics.wait; this worker runs async mysql2 and writes
 * JSON responses into a SharedArrayBuffer, then Atomics.notify.
 */
import { parentPort, workerData } from 'node:worker_threads';
import mysql from 'mysql2/promise';

const { controlSab, resultSab, config } = workerData;
const control = new Int32Array(controlSab);
const resultBytes = new Uint8Array(resultSab);

const encodeResponse = (payload) => {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8');
  if (encoded.length > resultBytes.length) {
    throw new Error(
      `MySQL sync worker response too large (${encoded.length} > ${resultBytes.length})`,
    );
  }
  resultBytes.set(encoded.subarray(0, encoded.length), 0);
  control[1] = encoded.length;
};

const reply = (payload) => {
  encodeResponse(payload);
  Atomics.store(control, 0, 1);
  Atomics.notify(control, 0, 1);
};

const normalizeRows = (rows) => {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map((row) => {
    if (row === null || typeof row !== 'object') {
      return row;
    }
    const out = {};
    for (const [key, value] of Object.entries(row)) {
      out[key] = typeof value === 'bigint' ? Number(value) : value;
    }
    return out;
  });
};

let connection;

try {
  connection = await mysql.createConnection({
    ...config,
    namedPlaceholders: true,
    multipleStatements: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
  });
  reply({ ok: true, type: 'ready' });
} catch (error) {
  reply({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
  // Keep the worker alive so the main thread can read the failure, then exit.
  setTimeout(() => process.exit(1), 50);
}

parentPort.on('message', async (message) => {
  try {
    switch (message.type) {
      case 'exec': {
        await connection.execute(message.sql, message.bind ?? {});
        reply({ ok: true });
        break;
      }
      case 'execMulti': {
        await connection.query(message.sql, message.bind ?? {});
        reply({ ok: true });
        break;
      }
      case 'query': {
        const [rows] = await connection.execute(message.sql, message.bind ?? {});
        reply({ ok: true, rows: normalizeRows(rows) });
        break;
      }
      case 'begin': {
        await connection.beginTransaction();
        reply({ ok: true });
        break;
      }
      case 'commit': {
        await connection.commit();
        reply({ ok: true });
        break;
      }
      case 'rollback': {
        await connection.rollback();
        reply({ ok: true });
        break;
      }
      case 'ping': {
        await connection.ping();
        reply({ ok: true });
        break;
      }
      case 'close': {
        await connection.end();
        reply({ ok: true });
        process.exit(0);
        break;
      }
      default:
        reply({ ok: false, error: `Unknown message type: ${message.type}` });
    }
  } catch (error) {
    reply({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
