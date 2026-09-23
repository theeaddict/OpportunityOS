-- 005_discovery_research.sql — Discovery & Research Engine support

-- Widen verification_status to the full allowed set (swap CHECK constraint).
ALTER TABLE business_contacts
  ALTER COLUMN verification_status TYPE VARCHAR(32),
  DROP CONSTRAINT chk_contacts_verification_status;
ALTER TABLE business_contacts
  ADD CONSTRAINT chk_contacts_verification_status CHECK (verification_status IN
    ('unverified','verified_public_whatsapp','phone_only','source_published','user_confirmed','invalid'));

-- CONTACT RULES backfill:
UPDATE business_contacts
   SET verification_status = 'verified_public_whatsapp'
 WHERE contact_type = 'whatsapp' AND verification_status = 'source_published';

UPDATE business_contacts
   SET verification_status = 'phone_only'
 WHERE contact_type = 'phone' AND verification_status IN ('unverified', 'source_published');

UPDATE search_jobs SET status = 'queued' WHERE status IN ('pending');

-- search_jobs status moves from pending to queued-first lifecycle.
ALTER TABLE search_jobs
  ALTER COLUMN status TYPE VARCHAR(10);
ALTER TABLE search_jobs
  ALTER COLUMN status SET DEFAULT 'queued',
  DROP CONSTRAINT chk_searchjobs_status;
ALTER TABLE search_jobs
  ADD CONSTRAINT chk_searchjobs_status CHECK (status IN ('queued','running','completed','failed'));

ALTER TABLE search_jobs
  ADD COLUMN dedup_hash CHAR(64) NULL;

CREATE INDEX idx_searchjobs_dedup ON search_jobs (dedup_hash, status);

ALTER TABLE search_queries
  ADD COLUMN keywords TEXT NULL,
  ADD COLUMN required_contact_type VARCHAR(20) NULL;