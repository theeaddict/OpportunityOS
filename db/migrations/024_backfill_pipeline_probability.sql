-- 024_backfill_pipeline_probability.sql
-- Opportunities auto-advanced by analysis (UPDATE status='researching') bypassed
-- updatePipeline(), so probability / weighted_pipeline / stage_entered_at were
-- left NULL and the pipeline UI showed '—'. Backfill the same defaults that
-- 013_pipeline.sql seeds and that updatePipeline() maintains.

UPDATE opportunities SET probability = 10  WHERE status = 'new'          AND probability IS NULL;
UPDATE opportunities SET probability = 20  WHERE status = 'researching'  AND probability IS NULL;
UPDATE opportunities SET probability = 30  WHERE status = 'qualified'    AND probability IS NULL;
UPDATE opportunities SET probability = 40  WHERE status = 'contacted'    AND probability IS NULL;
UPDATE opportunities SET probability = 50  WHERE status = 'replied'      AND probability IS NULL;
UPDATE opportunities SET probability = 60  WHERE status = 'demo'         AND probability IS NULL;
UPDATE opportunities SET probability = 70  WHERE status = 'proposal'     AND probability IS NULL;
UPDATE opportunities SET probability = 80  WHERE status = 'negotiation'  AND probability IS NULL;
UPDATE opportunities SET probability = 100 WHERE status = 'won'           AND probability IS NULL;
UPDATE opportunities SET probability = 0   WHERE status = 'lost'          AND probability IS NULL;
UPDATE opportunities SET probability = 0   WHERE status = 'not_a_fit'     AND probability IS NULL;
UPDATE opportunities SET probability = 0   WHERE status = 'not_a_service_fit' AND probability IS NULL;

UPDATE opportunities
  SET weighted_pipeline = ROUND(project_value * COALESCE(probability, 0) / 100 * 100) / 100
  WHERE project_value IS NOT NULL
    AND probability IS NOT NULL
    AND weighted_pipeline IS NULL;

UPDATE opportunities
  SET stage_entered_at = COALESCE(stage_entered_at, NOW()),
      days_in_stage = COALESCE(days_in_stage, 0)
  WHERE status != 'new' AND stage_entered_at IS NULL;