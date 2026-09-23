-- 011_discovery_pipeline.sql — Discovery pipeline progress tracking.
--
-- The one-click "Find opportunities" flow is a single background pipeline job.
-- search_jobs gains:
--   * stage          — the current real pipeline stage (discovering | researching |
--                      checking_contacts | analyzing | identifying_opportunities |
--                      calculating_scenarios | matching_solutions | ranking)
--   * result_summary — JSON with the final summarised outcome
--                      ({ businesses_researched, with_evidence, strong_opportunities,
--                         opportunity_ids }) written only when the job completes.

ALTER TABLE search_jobs
  ADD COLUMN stage          VARCHAR(40) NULL,
  ADD COLUMN result_summary JSONB        NULL;