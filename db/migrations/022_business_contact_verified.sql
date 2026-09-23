-- 022_business_contact_verified.sql
-- Persist whether a business was imported with a usable public contact
-- (phone or website). NULL = unknown/not applicable (manual entry); 0 = the
-- source listing had no public contact (needs manual follow-up); 1 = contact
-- published by the source. Used to flag discovery candidates that cannot be
-- reached without operator research.

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS contact_verified BOOLEAN NULL;