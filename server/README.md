# Worldo game service

The live game is mounted under /api/game. Old /api/session, /api/action, /api/live and practice-reset routes are removed.

## State and settlement

CityController coordinates the shared world. WorldStore persists one deployment-scoped document using Neon PostgreSQL revision compare-and-swap or a single-process atomic local file. Players, cities, driver balances, station tanks and contract reservations are validated together. All accepted economic effects and their outbox entries commit atomically. Economic operation IDs survive restarts for idempotent retries.

Local chain-off play uses a distinct local.worldo namespace and opaque HttpOnly, SameSite=Strict cookies. Chain-enabled play derives the account from verified social identity. The client cannot set balances, invent a player identity, teleport, or supply a settlement receipt. Simulation snapshots cannot enter the live store.

The city worker advances every five seconds. The background settler claims bounded immutable batches around every sixty seconds when a player action is waiting, and every five minutes when only city bookkeeping is. Neighbouring city updates are merged at claim time. An uncertain transaction retains its original signed envelope, batch ID and sequence for reconciliation. Confirming a batch removes only its included outbox entries, preserving newer accepted actions. The client never waits for this chain phase to trade.

A scoped game-token authority is checked locally from previously verified authorization. The world CAS reserves cumulative coin spend and records the authority epoch. Revocation freezes that epoch under the same CAS, producing the last accepted nonce; later settlement can finish those accepted actions. The contract locks direct external transfers to prevent the off-chain/outbox double-spend race. See [contract trust boundaries](../contracts/README.md).

## Routes

| Route | Purpose |
| --- | --- |
| GET /api/game/config | Public network/auth/local-mode configuration |
| GET /api/game/overview | Read-only world camera anchor |
| GET /api/game/session | Current authenticated/cookie-bound player and sync status |
| POST /api/game/action | Strict action + UUID operationId; returns persisted snapshot |
| POST /api/game/quote | Current quantity/reputation-aware trade quote |
| GET /api/game/equipment-prices | Current equipment and repair prices |
| GET /chain/status | Real batch health, backlog and confirmed receipt |
| /api/preview | Isolated scenario: step, reset, simulated station-price change only |
| /api/near | Social auth, sponsored authorization, readiness and account services |
| /api/intents | Optional mainnet wallet-funding quotes and reconciliation |
| /api/npc | Bounded mayor chat and optional speech |

Movement, proximity, line of sight, elapsed gather time, capacity, tool condition, fuel, stock and treasury are server-validated. Idle online clients acknowledge earnings every five seconds; offline reports only accumulate after a short presence grace period. Returning session reads perform bounded simulation catch-up before showing the report.

Mutation routes reject cross-site origins and Fetch Metadata requests; JSON has a16KiB limit and per-IP throttling. No public admin reset or client-controlled balance API exists. Provider replies never authorize economy mutations. NPC conversation context and reusable speech buffers are bounded and ephemeral; persistent provider budget accounting contains counters, not conversation transcripts.

Run one process for this release. PostgreSQL prevents lost economic updates, but social login sessions and some sponsor/provider coordination still live in memory. Durable operation IDs and world history grow over time; large deployments need an explicit archival/scaling design. Missing credentials produce unavailable service responses rather than simulated success.
