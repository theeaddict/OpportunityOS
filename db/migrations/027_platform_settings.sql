-- 027_platform_settings.sql
--
-- Platform-level settings for the superadmin control room. Accounts already
-- tune their own scoring thresholds via app_settings (account_id-scoped);
-- this table holds the SYSTEM-level defaults that any account WITHOUT its own
-- override inherits (lib/repositories/settings.js getScoreThresholds falls
-- back to these before the static DEFAULT_SCORE_THRESHOLDS). Written only by
-- the superadmin control room (requireSuperadmin), never by tenant APIs.
CREATE TABLE IF NOT EXISTS platform_settings (
  "key" VARCHAR(80) NOT NULL PRIMARY KEY,
  value JSONB NULL,
  updated_by BIGINT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);