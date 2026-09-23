-- 007: Deterministic Financial Opportunity Engine
-- Adds support for low/base/high assumption triples on the assumptions table,
-- and scenario_name + base_value on the scenarios table so every scenario stores
-- its full low/base/high result. impact_low/impact_high remain the persisted
-- low/high bounds (backward compatible).

ALTER TABLE opportunity_assumptions
  ADD COLUMN assumption_low  DECIMAL(14,4) NULL,
  ADD COLUMN assumption_high DECIMAL(14,4) NULL;

ALTER TABLE financial_scenarios
  ADD COLUMN scenario_name VARCHAR(80) NULL,
  ADD COLUMN base_value    DECIMAL(14,2) NULL;

-- Index so assumptions can be looked up by scenario when editing triples.
CREATE INDEX idx_assumptions_opp ON opportunity_assumptions (opportunity_id);