-- 026_superadmin.sql
--
-- A platform-tier SUPERADMIN flag on users, orthogonal to the tenant-scoped
-- role (owner/admin/member). is_superadmin can NEVER be set through the
-- application: the members APIs and register only ever write `role`, and no
-- settings/membership form touches this column. It is granted only directly
-- in the DB or by the one-time seed scripts (scripts/setup-db.js bootstrap
-- admin, scripts/grant-superadmin.js).
ALTER TABLE users ADD COLUMN is_superadmin BOOLEAN NOT NULL DEFAULT FALSE;