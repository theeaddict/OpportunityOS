# OpportunityOS — Database Architecture (v2)

MySQL/MariaDB + mysql2. No MongoDB, no ORM. Versioned SQL migrations applied by a
small runner and tracked in `schema_migrations`.

```
db/migrations/
  001_init.sql               full schema: tables, FKs, indexes, unique constraints
  002_seed_solutions.sql     solution library + SOLUTION_PROBLEMS + SOLUTION_INDUSTRIES
  003_seed_demo_data.sql     DEMO MODE data — every record fictional & marked
  004_outreach_variants.sql   outreach message variants column
  005_discovery_research.sql  contact verification statuses; search_queries keywords +
                              required_contact_type; search_jobs queued status + dedup_hash
  011_discovery_pipeline.sql  search_jobs.stage + result_summary for the /discover one-click
                              background discovery pipeline
  012_outreach_lifecycle.sql  outreach_messages lifecycle_status (generated → approved →
                              contacted → replied → demo → proposal → won | lost | opted_out),
                              contacted_at, opted_out_at
  013_pipeline.sql           New 11-stage pipeline: status enum updated, project_value,
                              project_currency, probability, weighted_pipeline,
                              days_in_stage, stage_entered_at, notes on opportunities;
                              activity_log table for the full timeline; data migration
  014_capabilities.sql       New terminal status not_a_service_fit + user_capabilities
                              table (the operator's own business / capability profile)
  015_background_jobs.sql     background_jobs unified job queue (status/progress/attempts)
  016_owner_profiles.sql      Business Owner Mode profile + derived strategy
  017_multi_tenant.sql        accounts + billing_plans + account_usage + app_settings
                              (tenant-scoped settings; usage counters per period)
  018_tenant_uniques.sql      Dedup unique keys scoped to the owning account
  019_discover_schedules.sql  Per-account recurring discovery "watch" schedules
  021_billing_plans_watches.sql Cap active watches per plan (limit_watches)
  022_business_contact_verified.sql Whether a business has a usable public contact
  023_searchqueries_maturity_width.sql Widen business_maturity to fit 'established'
  024_backfill_pipeline_probability.sql Backfill probability for auto-advanced opportunities
  025_two_factor.sql           TOTP two-factor authentication
026_superadmin.sql           users.is_superadmin flag (LEGACY control-room gate —
                               retained for parity; superseded by 028 admin_users)
   027_platform_settings.sql    Platform-default settings key/value (scoring defaults)
   028_admin_users.sql          admin_users + admin_sessions + audit_logs.admin_user_id
                               (separate platform-admin identity, decoupled from tenants)
   029_billing_plans_crud.sql   billing_plans price_cents/currency/is_active; drop the
                               hard-coded chk_accounts_plan CHECK, FK from accounts instead
   030_api_keys_and_customer_care.sql api_keys (hashed platform API keys) + 
                               customer_care_contacts (reach-out queue)
scripts/migrate.js           migration runner (transactional per file)
scripts/setup-db.js          migrate + seed admin user (scrypt hash)
app/api/system/self-test     admin-only repository test suite (41 assertions)
```

Run: `node scripts/setup-db.js` (or `node scripts/migrate.js` for migrations only).

## Tables

users · sessions · admin_users · admin_sessions · businesses · business_sources ·
business_contacts · business_evidence · solutions · solution_problems ·
solution_industries · opportunities · opportunity_evidence ·
opportunity_assumptions · financial_scenarios · opportunity_solutions ·
outreach_messages · pipeline_events · activity_log · search_queries ·
search_jobs · background_jobs · ai_jobs · audit_logs · user_capabilities ·
owner_profiles · accounts · billing_plans · account_usage · app_settings ·
platform_settings · api_keys · customer_care_contacts · discover_schedules

## Design decisions worth knowing

- **Deduplication** — `businesses` carries `normalized_name` (UNIQUE),
  `website_normalized`, `phone_normalized`; `findBusinessByMatch()` checks name →
  website → phone → social/external identifier in that order.
  `findOrCreateBusiness()` is the single entry point for imports and manual adds.
- **Normalization** (`lib/normalize.js`) — names strip punctuation + legal suffixes;
  phones stored as E.164-style `+<digits>` in `contact_value_normalized`;
  URLs lowercased, protocol/www/trailing slash removed. Contacts are UNIQUE per
  `(business_id, contact_type, contact_value_normalized)`.
- **Evidence principle** — `business_evidence.claim_type` ENUM(FACT, INFERENCE,
  HYPOTHESIS) with mandatory provenance via `source_id → business_sources`
  (source_type/name/url/external_identifier/status). `signal_key` is an extra
  column beyond spec; it feeds the deterministic problem-detection engine.
- **Contact rule** — WhatsApp has its own `contact_type`; the repository + ContactProvider
  accept WhatsApp only when the source explicitly publishes/confirms it
  (`source_published`/`user_confirmed` → stored as `verified_public_whatsapp`). Phone
  numbers whose WhatsApp status is unconfirmed are stored as `phone_only` and never
  promoted to WhatsApp automatically.
- **Opportunity scores** — the eight factor scores live in dedicated columns
  (`problem_severity_score … operational_complexity_score`) plus weighted
  `opportunity_score`. Scoring is deterministic application code.
- **Financial scenarios** — `financial_scenarios` stores scenario_type,
  formula_description, ILLUSTRATIVE impact_low/high bounds (×0.5 / ×1.5 around the
  formula result), period, assumptions_json and `is_illustrative=1`.
  `opportunity_assumptions` stores each assumption with unit/source/confidence
  (average_order_value, additional_orders, hours_saved, hourly_cost, …).
- **Solutions** — problems and industries are normalized into
  `solution_problems` / `solution_industries` rather than JSON arrays.
- **Jobs** — `search_queries` holds saved query configs (industry, location,
  platform, minimum_followers, maturity, problem_categories, keywords,
  required_contact_type); `search_jobs` tracks provider runs through a lifecycle
  (`queued → running → completed | failed`) with progress/attempts/error, and a
  `dedup_hash` so an identical queued/running job is never re-run. The /discover
  one-click pipeline (migration 011) adds `stage` (one of the 8 pipeline stages:
  discovering → researching → checking_contacts → analyzing →
  identifying_opportunities → calculating_scenarios → matching_solutions →
  ranking) and a `result_summary` JSON persisted on completion
  (`businesses_researched / with_evidence / strong_opportunities /
  opportunity_ids`). Every LLM call lands in `ai_jobs` with attempts + sha256
  input_hash + full output.
- **Background jobs (migration 015)** — `background_jobs` is the unified job
  queue backing the `DISCOVERY, RESEARCH, AI_RESEARCH, OPPORTUNITY_ANALYSIS,
  FINANCIAL_ANALYSIS, SOLUTION_MATCHING, OUTREACH_GENERATION, DEMO_GENERATION`
  job types. Columns: type, status
  (`queued → running → completed | failed | cancelled`), attempts, max_attempts,
  payload/result JSON, error, progress, stage, dedup_key (SHA-256), and
  cancel_requested. A claim increments `attempts`; a failure requeues while
  `attempts < max_attempts` and is terminal `failed` afterwards. `cancel_requested`
  stops a running job at the handler's next safe point — the worker marks it
  `cancelled`, never `completed`. `progress`/`stage` only ever reflect real work.
  The queue lives behind `lib/jobs/queue.js`, which mirrors the BullMQ Job API so
  Redis/BullMQ can replace the DB-backed store without touching handlers or UI.
  The worker runs in-process via `instrumentation.js` (`register()`,
  nodejs runtime only). The discovery pipeline now reports its 8 stages into
  `background_jobs` instead of `search_jobs` (search_jobs keeps legacy rows).
- **Pipeline** — status changes go exclusively through `updatePipeline()`, which
  writes `pipeline_events` (from/to/notes/actor) AND `activity_log` (the primary
  timeline). Every status change also updates `probability`, `weighted_pipeline`,
  `days_in_stage`, and `stage_entered_at`.
- **Business Owner Mode (migration 016)** — `owner_profiles` stores the
  non-technical owner's answers (business_name, sell_what, location,
  ideal_customers, goals JSON) plus the strategy the system derives and runs
  with (strategy JSON: owner-facing steps, plain focus, search filters). One row
  per user (`uk_owner_user`). Separated from `user_capabilities` because an
  owner's own product, not the solution library, defines the fit. Owner runs are
  `background_jobs` rows with `payload.owner_run = 1` (found via
  `JSON_EXTRACT(payload, '$.owner_run')`); they run the DISCOVERY handler with
  the capability gate bypassed.

### Pipeline tracking (migration 013 + 014)

- `opportunities.status` now has 12 values: `new`, `researching`, `qualified`,
  `contacted`, `replied`, `demo`, `proposal`, `negotiation`, `won`, `lost`,
  `not_a_fit`, `not_a_service_fit`.
- `project_value` / `project_currency` — what YOU could charge for the project.
  Separate from business impact (what the business could gain).
- `probability` — auto-set per stage (10% at new → 80% at negotiation, 100% won,
  0% lost/not_a_fit/not_a_service_fit).
- `weighted_pipeline` — `project_value × probability / 100`. Recalculated on
  project value or status change.
- `days_in_stage` — days since `stage_entered_at`. Reset on every status change.
- `notes` — free-text notes about the opportunity.
- `activity_log` — comprehensive timeline of all activity (status changes, notes,
  outreach events, demo generation, analysis). Seeded from `pipeline_events` for
  backward compatibility.

### User capabilities (migration 014)

`user_capabilities` (one row per user) holds the operator's own business profile —
the "My Capabilities" section on `/settings`:

- `business_name`, `location`, `services` — who you are and what you offer.
- `industries_served`, `technologies`, `solution_types` — JSON tag arrays.
- `enabled_solutions` — JSON array of solution ids the operator actually ships.
  When the profile exists, `matchSolutions()` excludes every solution not in this
  list (hard gate; empty list means "I build nothing").
- `min_project_value` / `max_project_value` — the acceptable quote range; solutions
  priced above `max` get a heavy commercial-fit penalty.
- `preferred_industries`, `preferred_locations`, `preferred_problem_categories`,
  `preferred_client_size` — soft preferences that nudge fit scores only.
- When a profile exists and a newly-detected opportunity has no matching enabled
  solution, the engine calls `opportunities.markNotAServiceFit()` — status
  `not_a_service_fit`, probability 0, no solution recommended, reason recorded in
  `notes` + `activity_log` (`pipeline_edit`). Without a profile, everything is
  treated as buildable (backward compatible).

### Outreach lifecycle (migration 012)

- `outreach_messages.lifecycle_status` (`ENUM`, default `generated`) tracks the
  contact lifecycle: `generated → approved → contacted → replied → demo → proposal →
  won` (happy path) or `→ lost` or `→ opted_out` (terminal).
- `contacted_at` (timestamp) is set on `contacted`; `opted_out_at` (timestamp) is set
  on `opted_out`. `opted_out` is terminal — no further actions are allowed.
- `variant` (`VARCHAR(20)`, migration 004) stores the message style: `short`,
  `normal`, or `professional`.
- `sent_status` is set to `sent` when a message is marked `contacted`; a `public`
  contact is required (the service checks `listContacts` for `verified_public_*`
  types).
- The **Personalized Outreach Engine** (`lib/services/outreach/`) generates 3
  evidence-driven message variants (short/normal/professional WhatsApp) from the
  opportunity's problem, money mechanism, scenario, evidence and recommended solution.
  When AI is unavailable the deterministic engine always produces messages; when AI
  succeeds the output is labeled with `ai_model`. Every message references real
  evidence; generic filler ("I help businesses…") is forbidden.

## Repository API (lib/repositories/)

Required functions implemented as named exports:

| Repo | Functions |
|---|---|
| businesses.js | createBusiness, findBusiness, updateBusiness, findOrCreateBusiness, findBusinessByMatch, addSource, addContact, listContacts, listSources, list, deleteBusiness |
| evidence.js | addEvidence, findById, listForBusiness, updateEvidence, removeEvidence, signalsForBusiness, evidenceBySignal |
| opportunities.js | createOpportunity, findById, findByBusinessAndProblem, list, updateAnalysis (factor columns), attachEvidence, linkedEvidence, matchSolution, replaceSolutionMatches, solutionLinks, updateOpportunityText, saveExplanation, getExplanation |
| financial.js | createAssumption, replaceAssumptions, listAssumptions, createFinancialScenario, replaceScenarios, listScenarios, updatePipeline, addPipelineEvent, eventsForOpportunity, recentEvents |
| solutions.js | list, all, findById, createSolution, setSolutionProblems, setSolutionIndustries, updateSolution |
| outreach.js | createOutreach, findById, listForOpportunity, updateDraft, markSent, setLifecycle, markOptedOut, isOptedOut |
| jobs.js | createSearchQuery, createQueuedSearchJob, startJob, setProgress, setJobStage, saveResultSummary, completeJob, failJob, getJob, listJobs, dedupHash |
| users.js | createUser, findByEmail, findById, updateProfile |
| capabilities.js | getCapabilities, saveCapabilities, hasCapabilityProfile |
| dashboard.js | getDashboard — read-only aggregation for the home page: money-focused metrics (new / hot / need-action / proposals / won / demos, business-impact pipeline = sum of illustrative annual impact across open opportunities, project-value pipeline = sum of recommended `project_value_base`) plus the ranked opportunity feed (scenarios, WhatsApp-verified, demo-ready, message counts) |

All statements are parameterized prepared statements — no string interpolation of
values anywhere.

### Money mechanisms & the structured opportunity explanation

- `opportunities.money_mechanism_key` (`VARCHAR(40)`, migration 006) stores the single
  dominant way money is made or saved (one of the 11 `MONEY_MECHANISM_KEYS`, e.g.
  `additional_sales`, `higher_conversion`, `reduced_waste`). The related
  `money_mechanism` column holds the human-readable HOW text.
- `opportunities.opportunity_explanation` (`JSON`, migration 006) holds the 4-part
  reasoning the detection engine must produce: `why_exists`, `evidence_support`,
  `money_impact`, `uncertain` — saved via `opportunities.js` `saveExplanation`.
- `financial_scenarios.period` distinguishes `monthly` vs `annual`; mechanism-driven
  templates annualise monthly scenarios (×12) for scoring so `money_potential` is a
  comparable annual illustrative figure (see `midpointAnnualPotential`).
- Weak candidates without a plausible mechanism (<0.4 confidence) are rejected by
  `shouldRejectCandidate` rather than proposed.

### Opportunity scoring (migration 010 scale)

- Each of the eight scoring factors is stored in its own `SMALLINT` column on
  `opportunities`: `evidence_strength_score`, `problem_severity_score`,
  `money_potential_score`, `business_maturity_score`, `ability_to_pay_score`,
  `solution_fit_score`, `contactability_score`, `operational_complexity_score`. The
  weighted total is `opportunity_score`.
- `opportunities.score_category` (`VARCHAR(10)`, migration 010) holds the derived
  bucket: **HOT / HIGH / MEDIUM / LOW / REJECT**.
- `opportunities.score_reasons` (`JSON`, migration 010) stores the per-dimension
  human-readable reasons (why each sub-score was awarded) plus an overall summary —
  rendered as the "Why this score" panel on the opportunity page.
- `app_settings` (migration 010) is a general key/value table. The `score_thresholds`
  key holds the category boundaries (`hot`/`high`/`medium`/`low`), configurable at
  runtime via `GET/POST /api/settings/score-thresholds` and the Settings page.
- Follower / audience counts are never stored or scored as a dominant dimension; they
  only contribute a small, capped bonus to the commercial (ability-to-pay) factor.

## Testing

`GET /api/system/self-test` (admin session required) executes 41 assertions against
the live DB covering normalization (incl. social handles), dedup, contact verification
rules (incl. WhatsApp-only-when-published and phone_only downgrade), evidence claim
types + signal aggregation, opportunity scoring math (exact expected weighted total,
per-dimension "out of weight" sub-scores, category classification incl. configurable
thresholds, follower-cap bounded support, reasons persistence), solution matching
persistence, assumptions/scenarios, mechanism-driven scenario math
(higher_conversion = monthly_enquiries × conversion_improvement × average_order_value),
mechanism→template mapping integrity, `shouldRejectCandidate` gating, and
saveExplanation/getExplanation round-trip — then cleans up its records. Last run:
**41/41 passed**.
