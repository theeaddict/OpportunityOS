-- 006_opportunity_engine.sql — Opportunity Detection Engine support
--
-- 1. money_mechanism_key: the enumerated commercial mechanism (from
--    MONEY_MECHANISMS) selected for this opportunity. Kept as a plain VARCHAR
--    so it can hold an unknown value without breaking.
-- 2. opportunity_explanation: structured WHY/WHAT/HOW/UNCERTAIN explanation
--    (JSON) produced by the detection engine. Never a forecast.

ALTER TABLE opportunities
  ADD COLUMN money_mechanism_key VARCHAR(40) NULL,
  ADD COLUMN opportunity_explanation JSONB NULL;

CREATE INDEX idx_opps_mechanism ON opportunities (money_mechanism_key);