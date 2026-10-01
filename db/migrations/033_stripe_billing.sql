-- 033_stripe_billing.sql
-- Real payment collection on top of the subscription-ready structures created
-- by 017_multi_tenant.sql (billing_plans, accounts.plan_code). Stripe Checkout
-- creates the subscription; the webhook is the ONLY writer of plan_code from
-- a billing event — nothing here charges anything by itself.
--
--   billing_plans.stripe_price_id  the Stripe Price to check out for this plan
--                                  (NULL = plan not purchasable — e.g. internal/free)
--   accounts.stripe_customer_id    set once, on first successful checkout
--   accounts.stripe_subscription_id  the currently active subscription, if any

ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(120) NULL;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(120) NULL;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(120) NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_stripe_customer ON accounts (stripe_customer_id);
