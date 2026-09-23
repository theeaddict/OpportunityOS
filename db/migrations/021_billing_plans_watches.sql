-- 021_billing_plans_watches.sql
-- Cap the number of ACTIVE recurring discovery "watch" schedules per plan.
-- NULL still means unlimited (internal plan). Counted at the request boundary
-- in POST /api/discover/schedules against enabled=1 rows.

ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS limit_watches INTEGER NULL;

UPDATE billing_plans SET limit_watches = 3  WHERE code = 'free';
UPDATE billing_plans SET limit_watches = 25 WHERE code = 'pro';