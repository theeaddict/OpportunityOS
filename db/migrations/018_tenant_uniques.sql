-- 018_tenant_uniques.sql
-- Scope the dedup unique keys to the owning account so two different workspaces
-- may each hold a business named "Acme POS" or a solution slug "pos-software"
-- without colliding (global uniqueness would be a cross-tenant denial).

ALTER TABLE solutions
  DROP CONSTRAINT uq_solutions_slug,
  ADD CONSTRAINT uq_solutions_account_slug UNIQUE (account_id, slug);

ALTER TABLE businesses
  DROP CONSTRAINT uq_businesses_normalized_name,
  ADD CONSTRAINT uq_businesses_account_name UNIQUE (account_id, normalized_name);