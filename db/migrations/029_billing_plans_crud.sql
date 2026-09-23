-- 029_billing_plans_crud.sql
-- STAGE 9: admin CRUD on billing_plans.
--
-- * Drop the hardcoded chk_accounts_plan CHECK so new plan codes become usable.
--   Validity is still enforced by the FK fk_accounts_plan -> billing_plans(code);
--   removing the literal list lets the admin define plans freely.
-- * Add price/currency + visible toggle (functional first, still useful for the
--   plans admin page). No rows are re-seeded here; scripts/setup-db.js is the
--   single source for default plans.

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS chk_accounts_plan;

ALTER TABLE billing_plans
  ADD COLUMN IF NOT EXISTS price_cents   INTEGER NULL,
  ADD COLUMN IF NOT EXISTS currency      VARCHAR(3)  NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS is_active     BOOLEAN     NOT NULL DEFAULT TRUE;

UPDATE billing_plans SET
  price_cents = CASE code WHEN 'internal' THEN NULL WHEN 'free' THEN 0 ELSE 9900 END;