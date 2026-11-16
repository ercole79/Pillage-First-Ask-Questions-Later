import type { DbFacade } from '@pillage-first/utils/facades/database';

export const metaSeeder = (database: DbFacade): void => {
  database.exec({
    sql:
      database.dialect === 'mysql'
        ? 'INSERT INTO meta (last_write) VALUES (UNIX_TIMESTAMP());'
        : 'INSERT INTO meta (last_write) VALUES (unixepoch());',
  });
};
