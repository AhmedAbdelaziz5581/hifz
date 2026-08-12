ALTER TABLE feedback ADD COLUMN ip TEXT;
CREATE INDEX IF NOT EXISTS idx_feedback_ip_created ON feedback (ip, created_at);
