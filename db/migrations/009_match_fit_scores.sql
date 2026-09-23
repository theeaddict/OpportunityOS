-- 009_match_fit_scores.sql — store the four fit dimensions and the configured
-- base project value on each matched solution so the UI can show WHY a solution
-- was recommended (per-dimension scores) rather than a single opaque number.

ALTER TABLE opportunity_solutions
  ADD COLUMN problem_fit     SMALLINT NULL,
  ADD COLUMN industry_fit    SMALLINT NULL,
  ADD COLUMN technical_fit   SMALLINT NULL,
  ADD COLUMN commercial_fit  SMALLINT NULL,
  ADD COLUMN project_value_base DECIMAL(12,2) NULL;