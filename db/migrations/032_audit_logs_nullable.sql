-- Audit rows are also written from platform/system paths (webhooks, admin
-- actions, cron) that have no tenant account to attach. Migration 017 forced
-- account_id NOT NULL DEFAULT 1, which invented a phantom "account 1" for
-- those rows. Make it nullable so unattributed audits are honestly NULL and
-- account-scoped queries (account_id = ?) never collapse them into tenant 1.
ALTER TABLE audit_logs ALTER COLUMN account_id DROP NOT NULL;