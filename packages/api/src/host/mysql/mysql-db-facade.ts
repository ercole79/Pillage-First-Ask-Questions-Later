import { z } from 'zod';
import type { DbFacade } from '@pillage-first/utils/facades/database';
import {
  type MysqlConnectionConfig,
  MysqlSyncClient,
} from './mysql-sync-client.ts';
import {
  looksLikeDdl,
  splitSqlStatements,
  sqliteDdlToMysql,
  sqliteDmlToMysql,
  toMysqlBind,
} from './sql-dialect.ts';

type QueryBind = Record<`$${string}`, unknown>;

type MysqlPreparedStatement = {
  bind: (params?: QueryBind) => MysqlPreparedStatement;
  stepReset: () => boolean;
  finalize: () => void;
};

const parseArray = <T extends z.core.$ZodType>(
  schema: T,
  values: unknown[],
): z.core.output<T>[] => z.array(schema).parse(values);

const isTriggerSql = (sql: string): boolean =>
  /^\s*(CREATE|DROP)\s+TRIGGER\b/i.test(sql);

const transformSql = (sql: string): string => {
  // Compound trigger bodies contain semicolons — do not run statement splitters.
  if (isTriggerSql(sql)) {
    return sql.replace(/\bunixepoch\s*\(\s*\)/gi, 'UNIX_TIMESTAMP()');
  }
  if (looksLikeDdl(sql)) {
    return sqliteDdlToMysql(sql);
  }
  return sqliteDmlToMysql(sql);
};

/**
 * MySQL-backed DbFacade implementing the same sync surface as SQLite WASM.
 *
 * Uses a persistent child-process mysql2 bridge so host controllers/resolvers/
 * seeders can stay synchronous (offline OPFS path unchanged).
 */
export const createMysqlDbFacade = (client: MysqlSyncClient): DbFacade => {
  let transactionDepth = 0;

  const runExec = (sql: string, bind?: QueryBind): void => {
    const transformed = transformSql(sql);
    const mysqlBind = toMysqlBind(bind as Record<string, unknown> | undefined);

    if (isTriggerSql(transformed)) {
      // mysql2 execute() cannot run compound statements; query() can.
      client.execMulti(
        transformed.trimEnd().endsWith(';') ? transformed : `${transformed};`,
        mysqlBind,
      );
      return;
    }

    const statements = splitSqlStatements(transformed);

    if (statements.length <= 1) {
      client.exec(transformed, mysqlBind);
      return;
    }

    client.execMulti(statements.map((s) => `${s};`).join('\n'), mysqlBind);
  };

  const runQuery = (
    sql: string,
    bind?: QueryBind,
  ): Record<string, unknown>[] => {
    const transformed = transformSql(sql);
    const mysqlBind = toMysqlBind(bind as Record<string, unknown> | undefined);
    return client.query(transformed, mysqlBind);
  };

  const facade: DbFacade = {
    dialect: 'mysql',

    exec: ({ sql, bind }) => {
      runExec(sql, bind as QueryBind | undefined);
    },

    execMulti: ({ sql, bind }) => {
      runExec(sql, bind as QueryBind | undefined);
    },

    selectValue: ({ sql, bind, schema }) => {
      const rows = runQuery(sql, bind as QueryBind | undefined);
      if (rows.length === 0) {
        return undefined;
      }
      const value = Object.values(rows[0])[0];
      if (value === undefined) {
        return undefined;
      }
      return z.parse(schema, value);
    },

    selectValues: ({ sql, bind, schema }) => {
      const rows = runQuery(sql, bind as QueryBind | undefined);
      const values = rows.map((row) => Object.values(row)[0]);
      return parseArray(schema, values);
    },

    selectObject: ({ sql, bind, schema }) => {
      const rows = runQuery(sql, bind as QueryBind | undefined);
      if (rows.length === 0) {
        return undefined;
      }
      return z.parse(schema, rows[0]);
    },

    selectObjects: ({ sql, bind, schema }) => {
      const rows = runQuery(sql, bind as QueryBind | undefined);
      return parseArray(schema, rows);
    },

    prepare: ({ sql }) => {
      let bound: QueryBind | undefined;
      const statement: MysqlPreparedStatement = {
        bind: (params) => {
          bound = params;
          return statement;
        },
        stepReset: () => {
          runExec(sql, bound);
          return true;
        },
        finalize: () => undefined,
      };
      return statement as unknown as ReturnType<DbFacade['prepare']>;
    },

    transaction: (callback) => {
      if (transactionDepth === 0) {
        client.begin();
      }
      transactionDepth += 1;
      try {
        callback(facade);
        transactionDepth -= 1;
        if (transactionDepth === 0) {
          client.commit();
        }
      } catch (error) {
        transactionDepth -= 1;
        if (transactionDepth === 0) {
          client.rollback();
        }
        throw error;
      }
    },

    serialize: () => {
      throw new Error('serialize() is not supported for MySQL host databases');
    },

    close: () => {
      client.close();
    },
  };

  return facade;
};

export const openMysqlSyncClient = (
  config: MysqlConnectionConfig,
): MysqlSyncClient => MysqlSyncClient.open(config);

export type { MysqlConnectionConfig };
