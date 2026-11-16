# `@pillage-first/game-server`

Online multiplayer host scaffold (vertical slice). Offline OPFS/`ApiWorker` is unchanged.

Design authority: project doc `online-mode-architecture.md`.

## What this PR scaffolds

| Piece                                                            | Status                                                                |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| HTTP adapter over `packages/api` `api-routes` / `matchRoute`     | Yes (`/api/*`)                                                        |
| Session stub → `RequestContext.playerId`                         | Yes (`Authorization: Bearer …`)                                       |
| Always-on scheduler (runs with client closed)                    | Yes                                                                   |
| WebSocket notifier filtered by `affectedVillageIds` / public map | Yes (`/ws?token=…`)                                                   |
| Per-world serial queue                                           | Yes                                                                   |
| MySQL adapter (pool + meta schema: accounts/sessions/worlds)     | Yes                                                                   |
| Game `DbFacade` on MySQL                                         | Follow-up (scaffold uses SQLite WASM kernel so resolvers stay shared) |
| Full multi-human authz / visibility                              | Follow-up                                                             |
| Web online fetcher swap                                          | Follow-up                                                             |

## Run

```bash
# from repo root
npm install
cp apps/game-server/.env.example apps/game-server/.env

# optional MySQL — if unreachable, server still starts (MYSQL_REQUIRED=false)
npm run start -w @pillage-first/game-server
```

- Health: `GET http://127.0.0.1:3010/health`
- Session: `GET http://127.0.0.1:3010/me` with `Authorization: Bearer dev-token`
- Game API: `GET http://127.0.0.1:3010/api/me/villages` (same bearer)
- WebSocket: `ws://127.0.0.1:3010/ws?token=dev-token`

Default stub map: `dev-token` → `playerId` 1; `admin-token` is admin for `/combat-simulator`.

## Tests

```bash
npm test -w @pillage-first/game-server
```

Includes a headless scheduler smoke test (events resolve with no HTTP/WS client).

## Constraints honored

- Offline OPFS path untouched
- Shared resolvers via `@pillage-first/api/host` (no resolver fork)
- Server clock: client `startsAt` / `duration` stripped on online writes
- Dev tools routes rejected online; combat simulator admin-gated
- Offline/online worlds separate (no OPFS import)
- NPC seeding = existing `migrateAndSeed` (same as offline)

## Follow-ups

1. Port game schemas/SQL dialect to MySQL behind `DbFacade`
2. Persist sessions in MySQL instead of env token map
3. Multi-world supervisor (scheduler today is process-global)
4. Wire `apps/web` online fetcher + WebSocket subscription
5. Authz/visibility for foreign movements beyond notifier filtering
6. Replace hard-coded `PLAYER_ID` inside resolvers with acting/owner player
