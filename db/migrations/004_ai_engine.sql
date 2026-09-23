-- 004_ai_engine.sql — AI engine support
-- ai_jobs gains solution_matching; outreach drafts gain a variant dimension
-- (the OUTREACH_AGENT produces short / normal / professional WhatsApp variants).

ALTER TABLE ai_jobs
  DROP CONSTRAINT chk_aijobs_job_type;
ALTER TABLE ai_jobs
  ADD CONSTRAINT chk_aijobs_job_type CHECK (job_type IN
    ('research_interpretation','opportunity_analysis','outreach_draft',
     'demo_specification','solution_matching'));

ALTER TABLE outreach_messages
  ADD COLUMN variant VARCHAR(20) NULL;