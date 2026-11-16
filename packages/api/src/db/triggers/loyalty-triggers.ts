import type { DbFacade } from '@pillage-first/utils/facades/database';

export const setupLoyaltyTriggers = (db: DbFacade): void => {
  if (db.dialect === 'mysql') {
    db.exec({ sql: 'DROP TRIGGER IF EXISTS loyalties_delete_capped_entries_after_update' });
    db.execMulti({
      sql: `
        CREATE TRIGGER loyalties_delete_capped_entries_after_update
        AFTER UPDATE ON loyalties
        FOR EACH ROW
        BEGIN
          IF NEW.loyalty >= 100 THEN
            DELETE FROM loyalties WHERE tile_id = NEW.tile_id;
          END IF;
        END
      `,
    });
    return;
  }

  db.execMulti({
    sql: `
      CREATE TRIGGER IF NOT EXISTS loyalties_delete_capped_entries_after_update
      AFTER UPDATE OF loyalty
      ON loyalties
      WHEN NEW.loyalty >= 100
      BEGIN
        DELETE FROM loyalties WHERE tile_id = NEW.tile_id;
      END;
    `,
  });
};
