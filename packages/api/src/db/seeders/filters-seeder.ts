import { PLAYER_ID } from '@pillage-first/game-assets/player';
import {
  reportFilterNameByScope,
  reportListingFilterSchema,
  reportScopeSchema,
} from '@pillage-first/types/dtos/report';
import type { DbFacade } from '@pillage-first/utils/facades/database';

export const filtersSeeder = (database: DbFacade): void => {
  const bind = {
    $player_id: PLAYER_ID,
    $filter_groups: JSON.stringify(
      reportScopeSchema.options.map((scope) => reportFilterNameByScope[scope]),
    ),
    $filters: JSON.stringify(reportListingFilterSchema.options),
  };

  if (database.dialect === 'mysql') {
    database.exec({
      sql: `
        INSERT INTO filters (player_id, name, filter)
        SELECT
          $player_id,
          filter_group.name,
          filter_row.filter
        FROM JSON_TABLE(
          CAST($filter_groups AS JSON),
          '$[*]' COLUMNS (name VARCHAR(191) PATH '$')
        ) AS filter_group
        CROSS JOIN JSON_TABLE(
          CAST($filters AS JSON),
          '$[*]' COLUMNS (filter VARCHAR(191) PATH '$')
        ) AS filter_row;
      `,
      bind,
    });
    return;
  }

  database.exec({
    sql: `
      INSERT INTO filters (player_id, name, filter)
      SELECT $player_id, filter_group.value, filter.value
      FROM JSON_EACH($filter_groups) AS filter_group
      CROSS JOIN JSON_EACH($filters) AS filter;
    `,
    bind,
  });
};
