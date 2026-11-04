-- The account-scoped live game record in lowland_sessions.data contains:
-- meta.pendingOracle: durable command, fixed nonce, attempt lease and post-confirmation world changes.
-- meta.confirmedOracleNonce: last observed on-chain oracle sequence.
-- meta.oracleReceipts: non-evicted completed request IDs for resource-effect idempotency.
-- This journal and the world revision are committed by a single PostgreSQL CAS update.
-- No extra table is required for the prototype. Do not delete these live records
-- during anonymous-session cleanup: live records have data->'state'->>'mode'='live'.
CREATE INDEX IF NOT EXISTS lowland_sessions_mode ON lowland_sessions ((data->'state'->>'mode'));
