/**
 * Shared SQLite → MySQL dialect adapters.
 *
 * Prefer transforming shared schema/query sources at the MySQL DbFacade boundary
 * (and a few hot-path hand ports) over forking resolvers.
 */

const MYSQL_RESERVED_COLUMN_NAMES = new Set(['interval', 'rank', 'system']);

/** Split a multi-statement SQL script on semicolons outside quotes/comments. */
export const splitSqlStatements = (sql: string): string[] => {
  const statements: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];
    const prev = sql[i - 1];

    if (inLineComment) {
      current += ch;
      if (ch === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      current += ch;
      if (ch === '*' && next === '/') {
        current += '/';
        i += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (!inSingle && !inDouble && !inBacktick) {
      if (ch === '-' && next === '-') {
        inLineComment = true;
        current += ch;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        current += ch;
        continue;
      }
    }

    if (ch === "'" && !inDouble && !inBacktick && prev !== '\\') {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSingle && !inBacktick && prev !== '\\') {
      inDouble = !inDouble;
      current += ch;
      continue;
    }
    if (ch === '`' && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
      current += ch;
      continue;
    }

    if (ch === ';' && !inSingle && !inDouble && !inBacktick) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = '';
      continue;
    }

    current += ch;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) {
    statements.push(trimmed);
  }

  return statements;
};

const quoteReservedIdentifiers = (sql: string): string => {
  let out = sql;
  for (const name of MYSQL_RESERVED_COLUMN_NAMES) {
    const re = new RegExp(`(?<![\\\`\\w])${name}(?![\\\`\\w])`, 'gi');
    out = out.replace(re, `\`${name}\``);
  }
  return out;
};

/** MySQL identifier limit is 64 chars — shorten long index/constraint names. */
const shortenMysqlIdentifiers = (sql: string): string => {
  return sql.replace(
    /\b(idx|uq|fk|trg|pk)_[A-Za-z0-9_]+/g,
    (name) => (name.length <= 64 ? name : name.slice(0, 64)),
  );
};

/** Remove CHECK (...) and CONSTRAINT name CHECK (...) clauses (paren-balanced). */
const stripAllCheckClauses = (sql: string): string => {
  const marker = /(?:CONSTRAINT\s+\w+\s+)?CHECK\s*\(/gi;
  let out = '';
  let lastIndex = 0;
  let match = marker.exec(sql);

  while (match) {
    const start = match.index;
    let i = start + match[0].length;
    let depth = 1;
    while (i < sql.length && depth > 0) {
      const ch = sql[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      i += 1;
    }
    out += sql.slice(lastIndex, start);
    lastIndex = i;
    match = marker.exec(sql);
  }

  out += sql.slice(lastIndex);
  // Drop line comments so comma cleanup can see adjacent commas.
  out = out.replace(/--[^\n]*/g, '');
  // After removing CHECK/CONSTRAINT CHECK blocks, collapse leftover commas.
  out = out.replace(/,(?:\s*,)+/g, ',');
  out = out.replace(/,\s*\)/g, ')');
  return out;
};

const transformDdlStatement = (statement: string): string => {
  let out = statement.trim();
  if (out.length === 0) {
    return out;
  }

  out = out.replace(/,\s*WITHOUT\s+ROWID\b/gi, '');
  out = out.replace(/\bWITHOUT\s+ROWID\b/gi, '');
  out = out.replace(/\)\s*STRICT\b/gi, ')');
  out = out.replace(/\bSTRICT\b/gi, '');

  out = out.replace(
    /\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi,
    'BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY',
  );
  out = out.replace(
    /\bINTEGER\s+PRIMARY\s+KEY\b/gi,
    'BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY',
  );

  out = out.replace(/\bINTEGER\b/gi, 'BIGINT');
  out = out.replace(/\bREAL\b/gi, 'DOUBLE');
  out = out.replace(/\bBLOB\b/gi, 'LONGBLOB');

  // Large JSON payloads stay as MEDIUMTEXT (no DEFAULT — MySQL forbids it).
  out = out.replace(/\b(meta|resources|reason_detail_json)\s+TEXT\b/gi, '$1 MEDIUMTEXT');
  // Short JSON defaults (trade_routes.minimum_resources) stay VARCHAR-capable.
  // Strip DEFAULT from any remaining MEDIUMTEXT/TEXT columns just in case.
  out = out.replace(
    /\b(MEDIUMTEXT|TEXT)\s+NOT\s+NULL\s+DEFAULT\s+(?:'(?:[^']|'')*'|\"(?:[^\"]|\"\")*\")/gi,
    '$1 NOT NULL',
  );

  // InnoDB cannot index unbounded TEXT without a prefix — map remaining TEXT
  // (enums, slugs, ids, short descriptions) to VARCHAR suitable for keys/defaults.
  out = out.replace(/\bTEXT\b/gi, 'VARCHAR(191)');

  // Partial UNIQUE indexes are not portable: demote to non-unique indexes and
  // drop the WHERE filter (keeps a helpful index without false uniqueness).
  out = out.replace(
    /CREATE\s+UNIQUE\s+INDEX\s+(\w+)\s+ON\s+(\w+)\s*\(([^)]+)\)\s*WHERE\s+.+$/gi,
    'CREATE INDEX $1 ON $2 ($3)',
  );
  out = out.replace(
    /CREATE\s+INDEX\s+(\w+)\s+ON\s+(\w+)\s*\(([^)]+)\)\s*WHERE\s+.+$/gi,
    'CREATE INDEX $1 ON $2 ($3)',
  );
  // Any remaining partial-index WHERE filters.
  out = out.replace(/\)\s*WHERE\s+.+$/gi, ')');

  out = out.replace(/\bunixepoch\s*\(\s*\)/gi, 'UNIX_TIMESTAMP()');

  // SQLite `IS <literal>` / `IS NOT <literal>` → `=` / `<>` (MySQL IS is NULL-only).
  out = out.replace(
    /\bIS\s+NOT\s+(?!NULL\b)('(?:[^']|'')*'|\d+(?:\.\d+)?)\b/gi,
    '<> $1',
  );
  out = out.replace(
    /\bIS\s+(?!NOT\b)(?!NULL\b)('(?:[^']|'')*')/gi,
    '= $1',
  );
  out = out.replace(/\bIS\s+(?!NOT\b)(?!NULL\b)(\d+(?:\.\d+)?)\b/gi, '= $1');

  // MySQL CHECK support is stricter than SQLite (CASE parsing, cross-column
  // column-level CHECKs, non-boolean). Drop CHECKs; app validation remains.
  out = stripAllCheckClauses(out);

  // SQLite scalar MAX(a,b) → GREATEST when a comma is present in the call head.
  out = out.replace(/\bMAX\s*\(([^)]*,[^)]*)\)/gi, 'GREATEST($1)');

  if (/^CREATE\s+TABLE\b/i.test(out) && !/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/i.test(out)) {
    out = out.replace(/^CREATE\s+TABLE\b/i, 'CREATE TABLE IF NOT EXISTS');
  }

  // MySQL cannot self-join TEMPORARY tables ("Can't reopen table"). Lookup
  // seed tables (unit_data / building_data) become regular InnoDB tables.
  out = out.replace(
    /^CREATE\s+TEMPORARY\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\b/i,
    'CREATE TABLE IF NOT EXISTS',
  );

  if (
    /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/i.test(out) &&
    !/ENGINE\s*=/i.test(out)
  ) {
    out = `${out} ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
  }

  // MySQL has no CREATE INDEX IF NOT EXISTS historically — leave as CREATE INDEX.
  // Duplicate index on reopen is avoided by skipping migrate when schema exists.

  return shortenMysqlIdentifiers(quoteReservedIdentifiers(out));
};

/**
 * Transform SQLite DDL (schemas/indexes) into MySQL 8 InnoDB DDL.
 */
export const sqliteDdlToMysql = (sql: string): string => {
  return splitSqlStatements(sql)
    .map(transformDdlStatement)
    .filter((statement) => statement.length > 0)
    .join(';\n');
};

/**
 * Transform common SQLite DML idioms into MySQL equivalents.
 * Complex table-valued JSON (`json_each` / `jsonb_each`) is hand-ported at call sites.
 */
/** Reorder SQLite `WITH … INSERT INTO … SELECT` into MySQL `INSERT … WITH … SELECT`. */
const rewriteWithInsert = (sql: string): string => {
  const match = sql.match(
    /^(\s*)WITH\s+([\s\S]+?)\s+INSERT\s+INTO\s+([^\s(]+)(\s*\([^)]*\))?\s+(SELECT\b[\s\S]*)$/i,
  );
  if (!match) {
    return sql;
  }
  const [, ws, cteBody, table, cols = '', select] = match;
  return `${ws}INSERT INTO ${table}${cols ?? ''}\nWITH ${cteBody}\n${select}`;
};

export const sqliteDmlToMysql = (sql: string): string => {
  let out = rewriteWithInsert(sql.trim());

  // SQLite CTE materialization hint is not valid in MySQL.
  out = out.replace(/\bAS\s+MATERIALIZED\b/gi, 'AS');

  out = out.replace(/\bunixepoch\s*\(\s*\)/gi, 'UNIX_TIMESTAMP()');
  out = out.replace(/\bINSERT\s+OR\s+IGNORE\b/gi, 'INSERT IGNORE');
  out = out.replace(/\bINSERT\s+OR\s+REPLACE\b/gi, 'REPLACE');

  // ON CONFLICT … DO NOTHING — drop clause; prefer INSERT IGNORE at call sites when needed.
  out = out.replace(/\s+ON\s+CONFLICT\s*\([^)]*\)\s+DO\s+NOTHING/gi, '');
  out = out.replace(/\s+ON\s+CONFLICT\s+DO\s+NOTHING/gi, '');

  // ON CONFLICT(...) DO UPDATE SET a = excluded.a → ON DUPLICATE KEY UPDATE a = VALUES(a)
  out = out.replace(
    /\s+ON\s+CONFLICT\s*(?:\([^)]*\))?\s+DO\s+UPDATE\s+SET\s+([\s\S]+?)(?=$|;)/gi,
    (_match, setClause: string) => {
      const rewritten = setClause.replace(/\bexcluded\.(\w+)/gi, 'VALUES($1)');
      return ` ON DUPLICATE KEY UPDATE ${rewritten}`;
    },
  );

  // SQLite GLOB → MySQL LIKE (* → %, ? → _).
  out = out.replace(/\bGLOB\b/gi, 'LIKE');
  out = out.replace(/LIKE\s+'([^']*)'/gi, (_m, pattern: string) => {
    const mysqlPattern = pattern.replaceAll('*', '%').replaceAll('?', '_');
    return `LIKE '${mysqlPattern}'`;
  });

  out = quoteReservedIdentifiers(out);

  // Named params: $name → :name (mysql2 namedPlaceholders).
  out = out.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, ':$1');

  return out;
};

export const toMysqlBind = (
  bind: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (!bind) {
    return undefined;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(bind)) {
    const normalized = key.startsWith('$') ? key.slice(1) : key;
    out[normalized] = value;
  }
  return out;
};

/** Heuristic: DDL scripts (CREATE/DROP/ALTER/TRIGGER/INDEX) vs DML. */
export const looksLikeDdl = (sql: string): boolean => {
  const head = sql.trimStart().slice(0, 32).toUpperCase();
  return (
    head.startsWith('CREATE') ||
    head.startsWith('DROP') ||
    head.startsWith('ALTER') ||
    head.startsWith('TRUNCATE')
  );
};
