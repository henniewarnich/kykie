-- v7.24.32 — Lightweight first-party visitor analytics
-- Per-pageload row: anonymous session id (random, stored in client localStorage),
-- path, referrer, optional logged-in user_id, and the user agent string for
-- after-the-fact bot filtering. No PII captured. Insert is open to anon so the
-- public landing pages get tracked; SELECT is admin-only.
-- Run in Supabase SQL editor (production + staging).

CREATE TABLE IF NOT EXISTS visit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  path        TEXT NOT NULL,
  referrer    TEXT,
  session_id  TEXT NOT NULL,
  user_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  user_agent  TEXT
);

CREATE INDEX IF NOT EXISTS idx_visit_log_created_at ON visit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visit_log_session    ON visit_log (session_id);
CREATE INDEX IF NOT EXISTS idx_visit_log_path       ON visit_log (path);

ALTER TABLE visit_log ENABLE ROW LEVEL SECURITY;

-- Anyone (including anonymous landing-page visitors) may insert a visit row.
-- No UPDATE / DELETE policy — rows are append-only from the client.
CREATE POLICY anon_insert_visit_log ON visit_log
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- Only admins (and commentator_admins, matching existing comm_log pattern) can read.
CREATE POLICY admin_read_visit_log ON visit_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'commentator_admin')
    )
  );
