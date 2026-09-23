-- 010_score_engine.sql — Opportunity Scoring Engine.
-- 1) Persist the evidence-strength subscore (the only one of the eight factors
--    that was previously computed but not stored), the derived HOT/HIGH/MEDIUM/
--    LOW/REJECT category, and a per-dimension set of human-readable reasons.
-- 2) Introduce an app_settings key/value table so the category thresholds are
--    configurable at runtime (defaults seeded in code, stored here once edited).

ALTER TABLE opportunities
  ADD COLUMN evidence_strength_score SMALLINT NULL,
  ADD COLUMN score_category          VARCHAR(10) NULL,
  ADD COLUMN score_reasons           JSONB NULL;

CREATE TABLE IF NOT EXISTS app_settings (
  "key"        VARCHAR(80) NOT NULL PRIMARY KEY,
  "value"      JSONB NULL,
  "updated_by" BIGINT NULL,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);