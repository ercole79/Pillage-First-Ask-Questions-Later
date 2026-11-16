import type { DbFacade } from '@pillage-first/utils/facades/database';

export const setupHistoryTriggers = (db: DbFacade): void => {
  if (db.dialect === 'mysql') {
    db.exec({ sql: 'DROP TRIGGER IF EXISTS trg_building_level_change_history_update' });
    db.execMulti({
      sql: `
        CREATE TRIGGER trg_building_level_change_history_update
        AFTER UPDATE ON building_fields
        FOR EACH ROW
        BEGIN
          IF OLD.level <> NEW.level THEN
            INSERT INTO building_level_change_history
              (village_id, field_id, building_id, previous_level, new_level, timestamp)
            VALUES
              (OLD.village_id, OLD.field_id, OLD.building_id, OLD.level, NEW.level, UNIX_TIMESTAMP());
          END IF;
        END
      `,
    });

    db.exec({ sql: 'DROP TRIGGER IF EXISTS trg_building_level_change_history_delete' });
    db.execMulti({
      sql: `
        CREATE TRIGGER trg_building_level_change_history_delete
        AFTER DELETE ON building_fields
        FOR EACH ROW
        BEGIN
          IF OLD.level > 0 THEN
            INSERT INTO building_level_change_history
              (village_id, field_id, building_id, previous_level, new_level, timestamp)
            VALUES
              (OLD.village_id, OLD.field_id, OLD.building_id, OLD.level, 0, UNIX_TIMESTAMP());
          END IF;
        END
      `,
    });

    db.exec({ sql: 'DROP TRIGGER IF EXISTS trg_unit_training_history_delete' });
    db.execMulti({
      sql: `
        CREATE TRIGGER trg_unit_training_history_delete
        AFTER DELETE ON events
        FOR EACH ROW
        BEGIN
          IF OLD.type = 'troopTraining' THEN
            INSERT INTO unit_training_history
              (village_id, batch_id, unit_id, building_id, amount, timestamp)
            SELECT
              OLD.village_id,
              JSON_UNQUOTE(JSON_EXTRACT(OLD.meta, '$.batchId')),
              (SELECT id FROM unit_ids WHERE unit = JSON_UNQUOTE(JSON_EXTRACT(OLD.meta, '$.unitId'))),
              (SELECT id FROM building_ids WHERE building = JSON_UNQUOTE(JSON_EXTRACT(OLD.meta, '$.buildingId'))),
              1,
              UNIX_TIMESTAMP()
            ON DUPLICATE KEY UPDATE
              amount = amount + 1,
              timestamp = UNIX_TIMESTAMP();
          END IF;
        END
      `,
    });
    return;
  }

  db.execMulti({
    sql: `
      CREATE TRIGGER IF NOT EXISTS trg_building_level_change_history_update
      AFTER UPDATE OF level ON building_fields
      WHEN OLD.level <> NEW.level
      BEGIN
        INSERT INTO building_level_change_history
          (village_id, field_id, building_id, previous_level, new_level, timestamp)
        VALUES
          (OLD.village_id, OLD.field_id, OLD.building_id, OLD.level, NEW.level, unixepoch());
      END;
    `,
  });

  db.execMulti({
    sql: `
      CREATE TRIGGER IF NOT EXISTS trg_building_level_change_history_delete
      AFTER DELETE ON building_fields
      WHEN OLD.level > 0
      BEGIN
        INSERT INTO building_level_change_history
          (village_id, field_id, building_id, previous_level, new_level, timestamp)
        VALUES
          (OLD.village_id, OLD.field_id, OLD.building_id, OLD.level, 0, unixepoch());
      END;
    `,
  });

  db.execMulti({
    sql: `
      CREATE TRIGGER IF NOT EXISTS trg_unit_training_history_delete
      AFTER DELETE ON events
      WHEN OLD.type = 'troopTraining'
      BEGIN
        INSERT INTO unit_training_history
          (village_id, batch_id, unit_id, building_id, amount, timestamp)
        SELECT
          OLD.village_id,
          JSON_EXTRACT(OLD.meta, '$.batchId'),
          (SELECT id FROM unit_ids WHERE unit = JSON_EXTRACT(OLD.meta, '$.unitId')),
          (SELECT id FROM building_ids WHERE building = JSON_EXTRACT(OLD.meta, '$.buildingId')),
          1,
          unixepoch()
        ON CONFLICT(batch_id, unit_id) DO UPDATE SET
          amount = amount + 1,
          timestamp = unixepoch();
      END;
    `,
  });
};
