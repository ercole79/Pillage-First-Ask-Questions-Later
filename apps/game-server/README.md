# `@pillage-first/game-server`

Online multiplayer host. Offline OPFS/`ApiWorker` is unchanged.

Design authority: project doc `online-mode-architecture.md`.

## What this hosts

| Piece                                                            | Status                                                                |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| HTTP adapter over `packages/api` `api-routes` / `matchRoute`     | Yes (`/api/*`)                                                        |
| Session stub → `RequestContext.playerId`                         | Yes (`Authorization: Bearer …`)                                       |
| Always-on scheduler (runs with client closed)                    | Yes                                                                   |
| WebSocket notifier filtered by `affectedVillageIds` / public map | Yes (`/ws?token=…`)                                                   |
| Per-world serial queue                                           | Yes                                                                   |
| MySQL meta schema (`online_accounts` / worlds / sessions)        | Yes                                                                   |
| Game `DbFacade` on MySQL (events, villages, troops, …)           | Yes — same database alongside `online_*`                              |
| SQLite WASM fallback when MySQL unreachable                      | Yes (`MYSQL_REQUIRED=false`)                                          |
| Full multi-human authz / visibility                              | Follow-up                                                             |
| Web online fetcher swap                                          | Wired in web (remote connection UX + HTTP/WS transport)               |

## Run against local MySQL

```bash
# from repo root
npm install
cp apps/game-server/.env.example apps/game-server/.env

# MySQL 8+ with a dedicated database/user (example):
#   CREATE DATABASE pillage_online CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
#   CREATE USER 'pillage'@'%' IDENTIFIED BY 'pillage';
#   GRANT ALL ON pillage_online.* TO 'pillage'@'%';
#   FLUSH PRIVILEGES;

npm run start -w @pillage-first/game-server
```

On startup you should see:

- `MySQL connected (pillage_online); meta schema ready`
- `game DB backend: mysql (MySQL — game tables alongside online_*)`

If MySQL is unreachable and `MYSQL_REQUIRED=false`, the server falls back to an **in-memory SQLite WASM** game kernel (state does not survive restart).

- Health: `GET http://127.0.0.1:3010/health` — includes `gameDb.backend` / `gameDb.dialect`
- Session: `GET http://127.0.0.1:3010/me` with `Authorization: Bearer dev-token`
- Game API: `GET http://127.0.0.1:3010/api/me/villages` (same bearer)
- WebSocket: `ws://127.0.0.1:3010/ws?token=dev-token`

Default stub map: `dev-token` → `playerId` 1; `admin-token` is admin for `/combat-simulator`.

### Env

| Variable | Default | Notes |
| --- | --- | --- |
| `MYSQL_HOST` / `PORT` / `USER` / `PASSWORD` / `DATABASE` | `127.0.0.1` / `3306` / `pillage` / `pillage` / `pillage_online` | Game + meta tables share this schema |
| `MYSQL_REQUIRED` | `false` | When `true`, refuse to start without MySQL |
| `PORT` | `3010` | HTTP + WS |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated; empty = allow all |

### CORS / web client

`CORS_ORIGINS` defaults to `http://localhost:5173` (Vite web app). Set additional origins as a comma-separated list if you use another host/port. Empty `CORS_ORIGINS` allows all origins in the scaffold.

### Run with the web UI

```bash
# terminal 1 — game-server
npm run start -w @pillage-first/game-server

# terminal 2 — web
npm run dev -w @pillage-first/web
```

In the browser open **Game worlds → Create or connect → Remote server**, keep defaults (`http://127.0.0.1:3010` + `dev-token`), and connect. Settings persist in `localStorage` so refresh keeps remote mode.

## Tests

```bash
npm test -w @pillage-first/game-server
```

Includes:

- Headless scheduler smoke (SQLite fallback path)
- MySQL migrate + event CRUD persist-across-reopen (skips if MySQL unreachable)

## Dev fallback story

| Situation | Game kernel |
| --- | --- |
| MySQL reachable | MySQL `DbFacade` via sync worker-thread bridge; `migrateAndSeed` once; reopen reuses tables |
| MySQL down, `MYSQL_REQUIRED=false` | In-memory SQLite WASM (same as earlier scaffold) |
| MySQL down, `MYSQL_REQUIRED=true` | Process exits |
| Offline browser worlds | Unchanged OPFS SQLite worker — not this app |

## Constraints honored

- Offline OPFS path untouched
- Shared resolvers via `@pillage-first/api/host` (no resolver fork)
- Shared schema SQL + dialect adapters (`packages/api/src/host/mysql/sql-dialect.ts`)
- Server clock: client `startsAt` / `duration` stripped on online writes
- Dev tools routes rejected online; combat simulator admin-gated
- Offline/online worlds separate (no OPFS import)
- NPC seeding = existing `migrateAndSeed` (same as offline)

## Follow-ups

1. Persist sessions in MySQL instead of env token map
2. Multi-world supervisor (scheduler today is process-global)
3. Authz/visibility for foreign movements beyond notifier filtering
4. Replace hard-coded `PLAYER_ID` inside resolvers with acting/owner player
5. Port remaining SQLite-only DML (`json_each` call sites outside seed/hot path) and report-retention trigger for MySQL
6. World isolation (`world_id` or per-world schema) for multi-tenant hosting
