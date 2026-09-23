-- 012_outreach_lifecycle.sql — Personalized Outreach Engine lifecycle tracking.
--
-- The Personalized Outreach Engine produces evidence-based, approved drafts that
-- the operator then drives through a full relationship lifecycle. outreach_messages
-- gains:
--   * lifecycle_status — the relationship state for a draft/message:
--                        generated | approved | contacted | replied | demo |
--                        proposal | won | lost | opted_out
--   * contacted_at     — when the message was first marked "contacted"
--   * opted_out_at     — when the recipient opted out (spam guard: any further
--                        automated outreach is suppressed for this message)

ALTER TABLE outreach_messages
  ADD COLUMN lifecycle_status VARCHAR(10) NOT NULL DEFAULT 'generated'
    CONSTRAINT chk_outreach_lifecycle_status CHECK (lifecycle_status IN
      ('generated','approved','contacted','replied','demo','proposal','won','lost','opted_out')),
  ADD COLUMN contacted_at TIMESTAMP NULL,
  ADD COLUMN opted_out_at TIMESTAMP NULL;