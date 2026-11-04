-- Apply to Neon or let the application create this table at first launch.
-- Demo worlds are isolated by opaque session, not shared between guests.
CREATE TABLE IF NOT EXISTS lowland_sessions (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lowland_sessions_updated_at ON lowland_sessions(updated_at);
