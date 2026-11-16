# `@pillage-first/game-server`

Online multiplayer host. Offline OPFS/`ApiWorker` is unchanged.

Design authority: project doc `online-mode-architecture.md`.

**MySQL is required.** There is no SQLite/WASM fallback for online — if MySQL is unavailable, game-server refuses to start so all players share one authoritative store.

## What this hosts

| Piece                                                            | Status                                              |
| ---------------------------------------------------------------- | --------------------------------------------------- |
| HTTP adapter over `packages/api` `api-routes` / `matchRoute`     | Yes (`/api/*`)                                      |
| Session stub → `RequestContext.playerId`                         | Yes (`Authorization: Bearer …`)                     |
| Always-on scheduler (runs with client closed)                    | Yes                                                 |
| WebSocket notifier filtered by `affectedVillageIds` / public map | Yes (`/ws?token=…`)                                 |
| Per-world serial queue                                           | Yes                                                 |
| MySQL meta schema (`online_accounts` / worlds / sessions)        | Yes                                                 |
| Game `DbFacade` on MySQL (events, villages, troops, …)           | Yes — same database alongside `online_*`            |
| SQLite WASM online fallback                                      | **Removed** — startup fails without MySQL           |
| Full multi-human authz / visibility                              | Follow-up                                           |
| Web online fetcher swap                                          | Wired in web (remote connection UX + HTTP/WS)       |

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
- `game DB backend: mysql (authoritative; game tables alongside online_*)`

If MySQL is unreachable, the process exits with a clear `FATAL` message (no silent SQLite fallback).

- Health: `GET http://127.0.0.1:3010/health` — includes `gameDb.backend` / `gameDb.dialect`
- Session: `GET http://127.0.0.1:3010/me` with `Authorization: Bearer dev-token`
- Game API: `GET http://127.0.0.1:3010/api/me/villages` (same bearer)
- WebSocket: `ws://127.0.0.1:3010/ws?token=dev-token`

Default stub map: `dev-token` → `playerId` 1; `admin-token` is admin for `/combat-simulator`.

### Env

| Variable | Default | Notes |
| --- | --- | --- |
| `MYSQL_HOST` / `PORT` / `USER` / `PASSWORD` / `DATABASE` | `127.0.0.1` / `3306` / `pillage` / `pillage` / `pillage_online` | Game + meta tables share this schema |
| `MYSQL_REQUIRED` | `true` | Online always needs MySQL; setting `false` is ignored for game-kernel startup (process still refuses without MySQL) |
| `PORT` | `3010` | HTTP + WS |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated; empty = allow all |

### CORS / web client

`CORS_ORIGINS` defaults to `http://localhost:5173` (Vite web app). Set additional origins as a comma-separated list if you use another host/port. Empty `CORS_ORIGINS` allows all origins in the scaffold.

### Run with the web UI

```bash
# terminal 1 — game-server (requires MySQL)
npm run start -w @pillage-first/game-server

# terminal 2 — web
npm run dev -w @pillage-first/web
```

In the browser open **Game worlds → Create or connect → Remote server**, keep defaults (`http://127.0.0.1:3010` + `dev-token`), and connect. Settings persist in `localStorage` so refresh keeps remote mode.

## Tests

```bash
# MySQL must be reachable (tests fail hard if not — no skip/fallback)
npm test -w @pillage-first/game-server
```

Includes MySQL migrate + event CRUD persist-across-reopen, and world-runtime against MySQL.

Headless scheduler smoke still uses in-memory SQLite via `@pillage-first/api/host` `openSeededHostDatabase` for isolated resolver/scheduler unit testing — that helper is **not** used by online game-server startup.

## Constraints honored

- Offline OPFS path untouched
- Shared resolvers via `@pillage-first/api/host` (no resolver fork)
- Shared schema SQL + dialect adapters (`packages/api/src/host/mysql/sql-dialect.ts`)
- Server clock: client `startsAt` / `duration` stripped on online writes
- Dev tools routes rejected online; combat simulator admin-gated
- Offline/online worlds separate (no OPFS import)
- NPC seeding = existing `migrateAndSeed` (same as offline)
- One authoritative MySQL store for all online players

## Follow-ups

1. Persist sessions in MySQL instead of env token map
2. Multi-world supervisor (scheduler today is process-global)
3. Authz/visibility for foreign movements beyond notifier filtering
4. Replace hard-coded `PLAYER_ID` inside resolvers with acting/owner player
5. Port remaining SQLite-only DML (`json_each` call sites outside seed/hot path) and report-retention trigger for MySQL
6. World isolation (`world_id` or per-world schema) for multi-tenant hosting
