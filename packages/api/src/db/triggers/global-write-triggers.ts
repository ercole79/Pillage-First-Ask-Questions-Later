import { z } from 'zod';
import type { DbFacade } from '@pillage-first/utils/facades/database';

export const setupGlobalWriteTriggers = (db: DbFacade): void => {
  const tables =
    db.dialect === 'mysql'
      ? db.selectValues({
          sql: `
            SELECT table_name AS name
            FROM information_schema.tables
            WHERE table_schema = DATABASE()
              AND table_type = 'BASE TABLE'
              AND table_name NOT REGEXP '_ids$'
              AND table_name NOT REGEXP '_history$'
              AND table_name != 'meta'
              AND table_name NOT LIKE 'online\\_%' ESCAPE '\\\\'
          `,
          schema: z.string(),
        })
      : db.selectValues({
          sql: "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_ids' AND name NOT LIKE '%_history' AND name != 'meta';",
          schema: z.string(),
        });

  for (const table of tables) {
    const triggerPrefix = `trg_update_meta_on_${table}`;
    const events = ['INSERT', 'UPDATE', 'DELETE'] as const;

    for (const event of events) {
      if (db.dialect === 'mysql') {
        // MySQL identifiers max out at 64 chars.
        const rawName = `${triggerPrefix}_${event.toLowerCase()}`;
        const triggerName =
          rawName.length <= 64 ? rawName : rawName.slice(0, 64);
        db.exec({ sql: `DROP TRIGGER IF EXISTS ${triggerName}` });
        db.execMulti({
          sql: `
            CREATE TRIGGER ${triggerName}
            AFTER ${event} ON ${table}
            FOR EACH ROW
            BEGIN
              UPDATE meta SET last_write = UNIX_TIMESTAMP();
            END
          `,
        });
      } else {
        db.execMulti({
          sql: `
            CREATE TRIGGER IF NOT EXISTS ${triggerPrefix}_${event.toLowerCase()}
            AFTER ${event} ON ${table}
            BEGIN
              UPDATE meta SET last_write = unixepoch();
            END;
          `,
        });
      }
    }
  }
};
