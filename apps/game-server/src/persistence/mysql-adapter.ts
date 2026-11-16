import mysql, {
  type Pool,
  type PoolOptions,
  type ResultSetHeader,
  type RowDataPacket,
} from 'mysql2/promise';
import type { Player } from '@pillage-first/types/models/player';
import type { GameServerConfig } from '../config.ts';

export type MysqlAdapterStatus = {
  readonly reachable: boolean;
  readonly database: string;
  readonly detail?: string;
};

/**
 * Online persistence adapter (MySQL only — no SQLite/WASM online fallback).
 *
 * Scope:
 * - Connection pool + health check (startup fails if unreachable)
 * - Meta schema for accounts/sessions/world registry (1 account = 1 character)
 * - Game kernel persistence uses a separate MySQL DbFacade (same database,
 *   game tables alongside `online_*`) via `@pillage-first/api/host`.
 */
export class MysqlAdapter {
  readonly pool: Pool;

  constructor(options: PoolOptions) {
    this.pool = mysql.createPool(options);
  }

  static fromConfig(config: GameServerConfig): MysqlAdapter {
    return new MysqlAdapter({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password,
      database: config.mysql.database,
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true,
    });
  }

  async healthCheck(): Promise<MysqlAdapterStatus> {
    try {
      const connection = await this.pool.getConnection();
      try {
        await connection.ping();
        return {
          reachable: true,
          database: String(connection.config.database ?? ''),
        };
      } finally {
        connection.release();
      }
    } catch (error) {
      return {
        reachable: false,
        database: '',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async ensureMetaSchema(): Promise<void> {
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS online_accounts (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        external_id VARCHAR(128) NOT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_online_accounts_external_id (external_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS online_worlds (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        slug VARCHAR(64) NOT NULL,
        name VARCHAR(128) NOT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_online_worlds_slug (slug)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 1 account = 1 character (player_id) per world.
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS online_world_characters (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        world_id BIGINT UNSIGNED NOT NULL,
        account_id BIGINT UNSIGNED NOT NULL,
        player_id BIGINT UNSIGNED NOT NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_world_account (world_id, account_id),
        UNIQUE KEY uq_world_player (world_id, player_id),
        CONSTRAINT fk_world_characters_world
          FOREIGN KEY (world_id) REFERENCES online_worlds (id)
          ON DELETE CASCADE,
        CONSTRAINT fk_world_characters_account
          FOREIGN KEY (account_id) REFERENCES online_accounts (id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS online_sessions (
        token_hash CHAR(64) NOT NULL,
        account_id BIGINT UNSIGNED NOT NULL,
        world_id BIGINT UNSIGNED NOT NULL,
        player_id BIGINT UNSIGNED NOT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        PRIMARY KEY (token_hash),
        CONSTRAINT fk_sessions_account
          FOREIGN KEY (account_id) REFERENCES online_accounts (id)
          ON DELETE CASCADE,
        CONSTRAINT fk_sessions_world
          FOREIGN KEY (world_id) REFERENCES online_worlds (id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  }

  async upsertStubCharacter(args: {
    worldSlug: string;
    worldName: string;
    accountExternalId: string;
    playerId: Player['id'];
  }): Promise<void> {
    const now = Date.now();
    const [worldResult] = await this.pool.execute<ResultSetHeader>(
      `
        INSERT INTO online_worlds (slug, name, created_at)
        VALUES (:slug, :name, :createdAt)
        ON DUPLICATE KEY UPDATE name = VALUES(name)
      `,
      {
        slug: args.worldSlug,
        name: args.worldName,
        createdAt: now,
      },
    );

    const [worldRows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT id FROM online_worlds WHERE slug = :slug LIMIT 1',
      { slug: args.worldSlug },
    );
    const worldId = Number(worldRows[0]?.id ?? worldResult.insertId);

    const [accountResult] = await this.pool.execute<ResultSetHeader>(
      `
        INSERT INTO online_accounts (external_id, created_at)
        VALUES (:externalId, :createdAt)
        ON DUPLICATE KEY UPDATE external_id = VALUES(external_id)
      `,
      {
        externalId: args.accountExternalId,
        createdAt: now,
      },
    );

    const [accountRows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT id FROM online_accounts WHERE external_id = :externalId LIMIT 1',
      { externalId: args.accountExternalId },
    );
    const accountId = Number(accountRows[0]?.id ?? accountResult.insertId);

    await this.pool.execute(
      `
        INSERT INTO online_world_characters
          (world_id, account_id, player_id, created_at)
        VALUES
          (:worldId, :accountId, :playerId, :createdAt)
        ON DUPLICATE KEY UPDATE player_id = VALUES(player_id)
      `,
      {
        worldId,
        accountId,
        playerId: args.playerId,
        createdAt: now,
      },
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
