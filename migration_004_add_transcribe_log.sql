-- Rate-limit tracking for /api/transcribe (cloud ASR is metered/paid, so this
-- endpoint needs a cap unlike the free static-content routes).
CREATE TABLE IF NOT EXISTS transcribe_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_transcribe_log_ip_created ON transcribe_log (ip, created_at);
