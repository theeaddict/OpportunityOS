-- 025_two_factor.sql
-- TOTP two-factor authentication (BiasharaOS internal/totp parity).
--
--   otp_secret           base32 TOTP secret once enabled (NULL when disabled)
--   otp_enabled          flag — login requires a code only when true
--   otp_backup_codes     JSON array of SHA-256 hashes of one-time backup codes
--   otp_pending_secret   secret being set up but not yet verified (enable step)

ALTER TABLE users ADD COLUMN otp_secret VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN otp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN otp_backup_codes TEXT NULL;
ALTER TABLE users ADD COLUMN otp_pending_secret VARCHAR(255) NULL;