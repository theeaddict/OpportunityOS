# OpportunityOS — Architecture & Development Plan

Business Opportunity Intelligence Platform. Discovers businesses, researches them with
publicly available information, identifies credible business problems, matches them to
software solutions, estimates financial impact as clearly-labeled scenarios, scores the
opportunity 0–100, and generates personalized outreach.

**Core rule: no AI-generated or assumed claim is ever presented as fact. Every important
claim carries a source, source URL, evidence text, evidence type and confidence.**

---

## 1. Architecture

```
app/                        Next.js App Router (JavaScript only, no src/)
  (auth)/login              Login / registration
  /                         Dashboard (money-focused: pipeline metrics + opportunity feed)
  discover                  Business Discovery — one-click “Find opportunities” form with
                            live 8-stage progress and a summary + ranked results
  businesses/[id]           Business profile + Research + Evidence + Opportunities
  opportunities/[id]        Opportunity detail (13 sections): Business context,
                            Opportunity score + re-analyze, Problem, Evidence with
                            source/URL/claim type/confidence, Why it matters, Money
                            opportunity with editable assumptions/scenarios, Recommended
                            solution + alternatives, Uncertainties, Outreach (3-variant
                            engine with lifecycle), Demo (Concept Demo Generator
                            with 8 industry templates, sample data, data structures),
                            Pipeline (events + status moves), Contact (verification),
                            Quality control (explicit pass/fail checklist — evidence
                            exists, at least one FACT not just inference, every claim
                            sourced, contact verified, WhatsApp never guessed, solution
                            within capability, outreach names the business).
                            Provenance Legend (fact/inference/hypothesis/assumption/
                            estimate/impact) displayed at top.
  pipeline                  Opportunity Pipeline — 11-stage Kanban + List view +
                            dashboard metrics (total/weighted pipeline, won revenue,
                            win rate, avg project value, avg days to close)
  solutions                 Solution Library
  jobs                      Unified background job queue page: every DISCOVERY /
                            RESEARCH / AI_RESEARCH / OPPORTUNITY_ANALYSIS /
                            FINANCIAL_ANALYSIS / SOLUTION_MATCHING /
                            OUTREACH_GENERATION / DEMO_GENERATION job with real
                            progress, attempts, retry + safe cancel actions
  settings                  Profile, My Capabilities (what you build & how you
                            price), service catalog, provider configuration
  admin                     Platform control room (admin_users identity +
                            oos_admin_session gate at the layout + every api/admin
                            route; own login at /admin/login; own nav in AdminShell)
    page.js                 Control room overview
    accounts                Workspace control room (suspend/reactivate, plan,
                            delete/purge, usage)
    plans                   Billing plan CRUD (price, currency, active, limits)
    api-keys                Hashed platform API keys (webhook auth), revoke
    customer-care           Customer reach-out queue records
    system                  Platform health: DB, worker, job queue, providers
    scoring                 Platform score-threshold defaults + override map
    usage                   Usage vs plan limits across every tenant
    audit                   Append-only audit_logs trail, filterable
  api/…                     Server-side API routes (Route Handlers)
    admin/…                 Admin-only endpoints (each requireSuperadmin())
      overview/ accounts/ accounts/[id]/ (status/ plan/ DELETE purge)
      plans/ plans/[code]/ api-keys/ api-keys/[id]/ customer-care/ customer-care/[id]/
      system/ scoring/ usage/ audit/ login/ logout/
    pipeline/                 GET: kanban data + metrics; POST activity: add notes
    settings/capabilities/    GET/PATCH: the user's own business capability profile

components/                 Shared UI (layout shell, cards, badges, forms)
  DashboardCards.js          Money-focused KPI metric cards (server)
  OpportunityFeedCard.js     Rich opportunity feed card + client actions
                             (View / Generate message / Generate demo / Move pipeline)
  ProvenanceTags.js          ProvenanceTag + ProvenanceLegend (fact/inference/hypothesis/
                             assumption/estimate/impact)
  OutreachEngine.js          3-variant outreach generator + per-message lifecycle actions
                             (Copy/Edit/Approve/Mark Contacted/Replied/Demo/Proposal/Won/
                             Lost/Opt out)
  DemoConcept.js             Concept Demo display: CONCEPT DEMO banner, industry pages
                            with descriptions, features, walkthrough, sample data tables,
                            data structures, customization points, disclaimer
  OpportunityControls.js     AnalyzeControl (re-analyze) + PipelineControl (status moves
                            using PIPELINE_TRANSITIONS per stage)
  PipelinePage.js            Client wrapper: Kanban/List toggle, metrics header
  PipelineKanban.js          9-column Kanban board with project value, probability,
                            weighted pipeline, days in stage, next action per card
  PipelineList.js            Sortable table view with all pipeline columns
  PipelineMetrics.js         Dashboard: total/weighted pipeline, won revenue, win rate,
                            avg project value, avg days to close
  ActivityTimeline.js        Vertical timeline with icons, actor, timestamp per activity
  CapabilitiesForm.js        "My Capabilities" editor: business identity, I-can-build
                             toggles per solution, services, technologies, industries,
                             pricing range, preferred targets & client size
  MyCapabilities.js          Read-only summary card: "I can build: …" + profile chips
lib/
  db.js                     mysql2/pg pool + query helper (single place for SQL access)
  auth.js                   Tenant session cookie auth (scrypt password hashing)
  admin-auth.js             Platform admin identity + oos_admin_session cookie
  accounts/                 Account-scoped mgmt used by the control room
    api-keys.js             Hashed API keys (issue/revoke/lookup by hash)
    customer-care.js        customer_care_contacts repository
    purge.js                Transactional workspace purge (keeps audit trail)
  audit.js                  Append-only audit trail (user_id / admin_user_id)
  validation.js             Small hand-rolled validators (no external deps)
  repositories/             One module per entity — the ONLY layer that writes SQL
    users.js businesses.js contacts.js evidence.js opportunities.js
    solutions.js outreach.js pipeline.js jobs.js queries.js settings.js
    capabilities.js          user_capabilities: business name, location, services,
                             industries/technologies/solution types, enabled
                             solutions, min/max project value, preferred targets
    dashboard.js             getDashboard() — aggregates money-focused metrics
                             (new/hot/need-action/proposals/won/demos, business-impact
                             & project-value pipelines) + the ranked opportunity feed
  jobs/                     Unified background job system (DB-backed MVP, migration 015)
    queue.js                The ONLY storage seam. enqueue (dedup via SHA-256,
                             optional maxAttempts), atomic claimNext (SKIP LOCKED),
                             reportProgress (real only), complete (only when work done),
                             fail (retry while attempts < max, else terminal), retry,
                             requestCancel (queued → instant; running → flag), get/list.
                             Mirrors the BullMQ Job API so Redis/BullMQ can replace the
                             DB store without touching handlers/UI.
    registry.js             Job type → handler catalog (also exports labels)
    worker.js               In-process worker (started by instrumentation.js). Claims one
                             job at a time, runs its handler, and marks completed/cancelled
                             strictly per real outcome; never fabricates progress.
    handlers/               One handler per type, wrapping the real engines:
                             discovery.js runDiscoveryPipeline; research.js
                             runAutomatedResearch; ai-research.js interpretResearch;
                             opportunity-analysis.js analyzeOpportunity (onProgress →
                             reportProgress); financial-analysis.js scenarios persist;
                             solution-matching.js matchSolutions →
                             replaceSolutionMatches; outreach-generation.js generateDraft;
                             demo-generation.js generateDemoSpec
instrumentation.js      Boots the background job worker once per server process
                        (register(), nodejs runtime only — skipped during build)
  services/
    discovery/              Provider interface + implementations
      index.js              registry (listProviders/getDiscoveryProvider/normalizeFilters)
                            runSearch() + importCandidates() (dedup, contacts, evidence)
      demo-data.js          Clearly-labeled fictional [DEMO] dataset
      pipeline.js           runDiscoveryPipeline(): background job that drives the
                            /discover one-click flow across 8 real stages (discovering →
                            researching → checking_contacts → analyzing →
                            identifying_opportunities → calculating_scenarios →
                            matching_solutions → ranking), reporting real progress into
                            background_jobs; uses analyzeOpportunity(..., {skipAi:true})
                            for fast, deterministic, real scoring, and honors cancel
                            requests at safe points between businesses
      providers/
        contracts.js        Provider interface contracts (JSDoc)
        contact-provider.js ContactProvider: normalization + WhatsApp/phone rules
    research/
      index.js              getResearchProvider() registry (website|http|manual)
      website-provider.js   Fetches the business's own public site politely (homepage +
                            up to 9 linked secondary pages across 11 page-type pools)
      website-finder.js     Optional: looks up a missing website via Google's official
                            Programmable Search Engine before research gives up on a
                            business (self-corrected — a wrong guess just yields no
                            evidence on the next real fetch, never a hard error)
      polite-fetcher.js     robots.txt parser + rate-limited fetcher + htmlToText
      coverage.js           13-aspect coverage model (what is / isn't covered)
      run.js                runAutomatedResearch(): findings -> evidence + coverage
    analysis/
      rules-analyzer.js     Deterministic signal→problem→solution engine
      matching.js           Solution Matching Engine: 4-fit scoring (problem,
                            industry, technical, commercial) weighted 40/15/20/25;
                            capability gate on enabled_solutions + preference
                            nudges (preferred industries/problems, price range)
                            from the user's capability profile
      scoring.js            Opportunity Scoring Engine: 8 weighted dims (0-100),
                            HOT/HIGH/MEDIUM/LOW/REJECT category + per-dim reasons
      scenarios.js          Financial scenario templates (illustrative only)
    outreach/
      index.js              Personalized Outreach Engine: builds 3 evidence-driven message
                            variants (short/normal/professional), lifecycle management
                            (approve/contacted/replied/demo/proposal/won/lost/opted_out),
                            pipeline event recording, opt-out guard
      prompts/outreach.js   P12 outreach prompt (tone: specific observation, no spam,
                            low-pressure CTA)
    demo/
      templates.js          Reusable industry demo configs (Furniture, Restaurant, Salon,
                            Hotel, Retail, Wholesale, Clinic, School): pages, features,
                            workflow, sample data, customization points. Template slug
                            mapping (DEMO_TEMPLATE_MAP) and industry keyword matching
                            (INDUSTRY_KEYWORDS).
      index.js              Concept Demo Generator: matches solution + business to the
                            best template, builds a concept demo spec with problem context,
                            filtered features, sample data tables, data structures, and
                            customization points. Always labeled "CONCEPT DEMO".
    ai/                     OPTIONAL provider-agnostic engine; inactive without AI_API_KEY
      client.js             HTTP transport (timeouts, retries, secret redaction)
      provider.js           generateStructured() validate→repair→fail
      schemas/ prompts/ agents/ jobs.js
db/
  migrations/               Versioned SQL migrations (001_init.sql … 027_platform_settings.sql)
scripts/
  migrate.js                Transactional migration runner (schema_migrations tracking)
  setup-db.js               migrate + seed (solution library, demo data, admin
                            users + admin login)
```

### Data flow (the "Opportunity" lifecycle)

1. **Discover** — `search_queries` record the filters; every run is a `DISCOVERY`
   record in `background_jobs` (`queued → running → completed | failed | cancelled`
   with progress, stage, attempts, error and a SHA-256 `dedup_key` — identical
   in-flight jobs are never re-run). A provider returns candidate businesses;
   nothing is saved until the operator reviews and imports. Import dedupes across
   normalized name / website / phone / social handle, classifies contacts via the
   ContactProvider (WhatsApp only when explicitly published; otherwise `phone_only`),
   records the discovery source on `business_sources`, and imports candidate evidence
   with provenance. The **/discover** one-click flow sugar-coats this into a
   non-technical form (industry / location / platform / minimum audience / maturity /
   problem categories / solutions). `POST /api/discover` enqueues a `DISCOVERY`
   background job (the in-process worker picks it up) and returns
   `{job_id, started, duplicate, status, stage, progress}`; the client polls
   `GET /api/discover/jobs/[id]` every 1.5s for the real stage/progress until it
   reaches `completed` / `failed` / `cancelled`, then renders the summary
   (businesses researched / with evidence / strong opportunities) and the ranked
   opportunities. Progress is real — each stage reflects actual work written to
   `background_jobs` by the pipeline.
2. **Research** — coverage-driven. The workspace shows which of 13 aspects are covered
   and never invents the rest. `website` provider politely fetches the business's own
   public site (robots.txt + rate limits); findings become `business_evidence` rows with
   source/url/type/confidence. Maturity signals are derived **only** from evidence.
   Discovery providers (`google_places`, `osm_overpass`) also contribute evidence at
   import time: a confirmed-active listing (has reviews or a published phone/OSM tag)
   with genuinely no website on file becomes `no_public_website` (`INFERENCE`, 0.55–0.7
   confidence) — a business with zero online presence is itself a strong, honest signal,
   not silence. Without this, such businesses produced no evidence at all and were
   invisible to the pipeline (rejected as too-weak-evidence) despite being some of the
   clearest opportunities. `no_public_website` counts toward the "Online sales" coverage
   aspect and alone is enough to propose a `poor_conversion` opportunity (see Analyze).
   Google Places' `reviews` field (up to 5, `evidence_type: 'customer_review'`) is also
   scanned for the same signal vocabulary the website crawler uses — real evidence for
   businesses with no website at all. A single reviewer's complaint is real but weaker
   than the business's own published content, so it's always `INFERENCE` at 0.45–0.5
   confidence; pain signals (`unanswered_enquiries`, `no_online_ordering`, …) only match
   reviews rated ≤3 stars so a phrase in a glowing review can't misread as a complaint.
   When no provider supplied a website at all, `website-finder.js` (optional, needs
   `GOOGLE_CUSTOM_SEARCH_API_KEY`/`_CX`) looks one up via Google's official Programmable
   Search Engine — never by scraping search result pages, which would violate Google's
   ToS — and only ever fills an empty `businesses.website` (never overwrites a
   provider-confirmed one); the match is recorded as an unconfirmed `INFERENCE` and the
   website crawler then fetches it for real content on the very next step, so a wrong
   guess just yields no evidence rather than corrupting anything.
 3. **Analyze** — the rules analyzer maps evidence-backed signals to problem types
    (`lost_sales`, `manual_booking`, …). Each proposed opportunity stores the problem,
    why-it-matters, a **money mechanism** (`money_mechanism_key` — e.g.
    `higher_conversion`, `additional_sales`), a structured 4-part explanation
    (`opportunity_explanation`: why_exists / evidence_support / money_impact /
    uncertain), and links its supporting evidence via `opportunity_evidence`.
    Candidates with weak evidence (<0.4 confidence) or no plausible mechanism are
    rejected via `shouldRejectCandidate` — the engine says NO rather than invent a
    weak opportunity, and records the rejection.
 4. **Capability gate** — when the operator has saved a "My Capabilities" profile, the
    Solution Matching Engine only considers **enabled** solutions. If a detected
    opportunity's problem is not served by any enabled solution, the opportunity is
    created and immediately marked **NOT_A_SERVICE_FIT** (probability 0, no solution
    recommended, reason recorded in notes + activity log, excluded from the pipeline
    board). This guarantees the platform never recommends a system the operator cannot
    build or sell. Disabled solutions are never recommended; preferred industries,
    preferred problem categories and the min/max pricing range only nudge fit scores,
    they never hard-block.
 5. **Match & Score** — `opportunity_solutions` links problems to the `solutions`
    library; `scoring.js` (the **Opportunity Scoring Engine**) scores each opportunity
    0–100 across eight weighted dimensions — Evidence strength (20), Problem severity
    (15), Money potential (15), Business maturity (10), Ability to pay (10), Solution
    fit (15), Contactability (5), Operational complexity (10, lower is better). The
    overall score is classified into **HOT (≥90) / HIGH (≥80) / MEDIUM (≥65) / LOW
    (≥50) / REJECT (<50)**, with boundaries configurable via `app_settings` and the
    Settings page. Every dimension gets a human-readable **reason** (`score_reasons`)
    explaining exactly why that sub-score was awarded. Follower / audience counts are
    never a dimension — they only feed the commercial (ability-to-pay) factor as a
    small, hard-capped supporting signal, so they can never dominate the score. Each
    of the eight factors is stored in its own column plus `evidence_strength_score`,
    `score_category`, and `score_reasons`.
 6. **Estimate** — financial scenarios are **mechanism-driven**:
    `buildScenariosByMechanism` derives the template from the selected
    `money_mechanism_key` (e.g. `higher_conversion` →
    `monthly_enquiries × conversion_improvement × average_order_value`), producing
    *illustrative* monthly/low/high ranges that are annualised (×12) for scoring.
    Assumptions are shown next to every number. Language is always illustrative
    ("Under these assumptions…"), never a forecast.
 7. **Outreach** — the Personalized Outreach Engine generates 3 evidence-driven message
    variants (short/normal/professional WhatsApp) referencing the problem, money
    mechanism, scenario, evidence and recommended solution. Messages follow P12 rules:
    specific observation ("I noticed…"), no filler ("I help businesses…"), natural
    low-pressure CTA. AI-generated when a provider is available; deterministic
    evidence-based template otherwise (clearly labeled `ai_model=null`). Lifecycle
    tracks: `generated → approved → contacted → replied → demo → proposal → won | lost
    | opted_out`. Approval is required before contact. Opt-out is terminal — no
    further messages. Contact requires a linked public contact. All transitions are
    audit-logged and update the opportunity pipeline via `updatePipeline()`.
 8. **Pipeline** — 12-stage flow: NEW → RESEARCHING → QUALIFIED → CONTACTED →
    REPLIED → DEMO → PROPOSAL → NEGOTIATION → WON / LOST / NOT_A_FIT /
    NOT_A_SERVICE_FIT (the last is set only by the capability gate). Every
    transition records in `pipeline_events` + `activity_log`, auto-sets probability
    (10%–100%), recalculates weighted pipeline (project_value × probability),
    resets days_in_stage. Dashboard shows total pipeline, weighted pipeline, won
    revenue, win rate, avg project value, avg days to close. Project value (what you
    charge) is always separate from business impact (what the business gains).
    NOT_A_SERVICE_FIT and LOST are terminal and excluded from the Kanban board.

## 2. Database schema (MySQL/MariaDB)

Key entities: businesses, sources, evidence, opportunities, solutions,
opportunity_solutions, financial scenarios/assumptions, outreach_messages,
pipeline_events, activity_log, search_queries/jobs, app_settings,
user_capabilities, owner_profiles. Design points:

- `business_evidence` / `opportunity_evidence` enforce the evidence principle.
- `opportunities.problem_type` uses an enum of the 21 programmatically detected
  problem types.
- `opportunities.score_json` stores per-factor breakdown for transparency.
- `solutions` is the editable library (seeded with the 22 deliverable solution
  types).
- `user_capabilities` stores the operator's own business profile (what they
  build, enabled solutions, pricing range, preferred targets).
- `owner_profiles` (Business Owner Mode) stores the non-technical owner's four
  answers plus the derived strategy; Owner decisions happen in plain language.
- All FKs are `ON DELETE CASCADE` where child-of-parent, `SET NULL` where optional.

See `db/schema.sql`.

### Platform admin control room

A platform-wide surface at `/admin/*`, gated by its **own identity** — `admin_users`
(migration `028_admin_users.sql`) with the separate `oos_admin_session` cookie, set
only by `/admin/login`. The legacy `users.is_superadmin` flag is deliberately NOT
honored. `requireSuperadmin()` (in `lib/api-helpers.js`, backed by
`lib/admin-auth.js`) re-checks the identity from the DB on every admin page and
every `/api/admin/*` route — a stale cookie or a stale role is not enough; it is
never grantable through any account-management API. Admin routes are NOT
rate-limited like auth (login/registration are, to prevent brute force) and are
independently CSRF-protected (mutating admin routes echo `oos_admin_csrf` via the
standard `request.method` proxy check). Surfaces: overview, accounts
(suspend/reactivate, plan changes, permanent purge — all audited), billing plan
CRUD (`billing_plans`, migration `029`), API keys (`api_keys`, migration `030`,
hash-stored, shown once, used by the ingest webhook via `X-Opportunityos-Api-Key`),
customer care (`customer_care_contacts`, migration `030`), system health
(DB/worker/jobs/providers), scoring thresholds (platform defaults in
`platform_settings`, migration `027`), usage vs plan limits, and the audit log.
The audit log reads the append-only `audit_logs` table written by
`lib/audit.js::audit()` — every admin mutation writes an action
(`admin.account_suspended`, `admin.scoring_defaults_updated`, `admin.account_deleted`,
…) attributed to `admin_user_id` (with `account_id` set), and the UI's reported
counts match the table exactly (asserted by e2e PDFMSE17–28).

### Billing (Stripe)

Real payment collection on top of the subscription-ready `billing_plans` /
`accounts.plan_code` structures (migration `033_stripe_billing.sql`,
`lib/billing/stripe.js`). Deliberately raw `fetch` + form-encoding, no `stripe`
SDK dependency — mirrors `lib/ai/client.js` and the discovery providers: a
thin, inspectable REST wrapper, feature-detected via `STRIPE_SECRET_KEY` so the
app degrades to a clear "not configured" error (never a fabricated purchase)
until an operator connects a real Stripe account.

- An operator sets a plan's Stripe **Price** id in the admin Plans page
  (`billing_plans.stripe_price_id`) — a plan with none stays un-purchasable.
- `POST /api/billing/checkout` (account **OWNER**-only) creates a Checkout
  Session; account id + target plan code travel in `metadata` on both the
  session and `subscription_data.metadata` (Stripe copies the latter onto the
  resulting subscription), so every later webhook event is self-contained —
  no `customer_id → account_id` lookup table needed.
- `POST /api/billing/webhook` is the **only** writer of `plan_code` from a
  billing event. Auth is the raw-body HMAC signature (`Stripe-Signature`,
  verified against `STRIPE_WEBHOOK_SECRET`) — never a session, so it carries no
  cookie and is explicitly exempted in `proxy.js` alongside the ingest webhook.
  Handles `checkout.session.completed` (activate the plan, store
  `stripe_customer_id`/`stripe_subscription_id`) and
  `customer.subscription.deleted` (revert to `free`).
- `POST /api/billing/portal` hands the OWNER a Stripe Billing Portal link to
  manage or cancel their own subscription.
- Tested end-to-end against `scripts/mock-stripe.mjs` (real Stripe API request
  shapes; `/ctl/*` endpoints simulate a completed checkout or a cancelled
  subscription by firing a correctly-signed webhook at the app) —
  `test/billing.test.mjs`, PDFMSBILL01–04: not-purchasable plan refused,
  OWNER-only gate, the full checkout→webhook→plan_code→cancellation loop, and
  invalid-signature rejection.

## 3. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | `mysql://user:pass@host:3306/opportunityos` |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | alt | Individual vars (used if `DATABASE_URL` absent) |
| `APP_URL` | no | Base URL used in generated links |
| `SESSION_SECRET` | no | Reserved for future session signing — NOT read by any current code (sessions are DB-backed with signed cookie pair values); no longer present in `.env.example` |
| `AI_API_KEY` / `AI_MODEL` | no | Optional AI engine (OpenAI-compatible); app fully functional without |
| `AI_BASE_URL` | no | Override AI endpoint (default `https://api.openai.com/v1`) |
| `RESEARCH_PROVIDER` | no | `website` (default) · `http` · `manual` |
| `RESEARCH_API_URL` | no | Operator endpoint used when `RESEARCH_PROVIDER=http` |
| `STRIPE_SECRET_KEY` | no | Enables real billing (Checkout + Portal); absent = clear "not configured" errors, no upgrade UI |
| `STRIPE_WEBHOOK_SECRET` | no | Required for `/api/billing/webhook` to accept events |
| `STRIPE_API_BASE_URL` | no | Override Stripe API endpoint (tests point this at `scripts/mock-stripe.mjs`) |

## 4. Development plan (implemented in order)

1. Scaffold Next.js (JS, App Router, Tailwind) ✔ plan
2. Schema + seed + setup script
3. DB layer + repositories + auth
4. App shell (nav, responsive layout), Dashboard
5. Discovery → Research/Evidence → Analysis/Scoring → Solutions → Outreach → Pipeline → Settings
6. Verification: apply schema to MariaDB when available; `next build`; scripted API smoke test.

## 5. AI engine layout

```
lib/ai/
  provider.js    abstraction; app code calls aiProvider.generateStructured(...)
  client.js      transport (timeout, transient retries, JSON parse, no key logging)
  schemas/       strict per-agent output validators (+ repair descriptions)
  prompts/       safety-grounded prompt builders (common preamble)
  agents/        BUSINESS_RESEARCH / OPPORTUNITY_ANALYST / SOLUTION_MATCHING /
                 OUTREACH / DEMO_SPEC
  jobs.js        ai_jobs lifecycle logging (id, agent, model, duration, status)
```

Env: `AI_API_KEY`, `AI_MODEL`, optional `AI_BASE_URL`, `AI_TIMEOUT_MS`.
Invalid model output gets exactly one schema-driven repair attempt; persistent
invalidity marks the job failed. Without configuration the deterministic rule
engine runs and is always labeled `analysis_provider='rules'`.

## 6. Honesty guarantees

- Sample discovery data is stamped `source_type = 'sample'` and badged **SAMPLE DATA**
  everywhere it appears.
- Scores show their factor breakdown; scenarios show their formula and assumptions;
  unconfigured providers return explicit "not configured" states instead of pretending.
- **Job progress is never fabricated.** `background_jobs.progress`/`stage` change only
  at real milestones reported by handlers; the worker marks a job `completed` only
  when its handler fully finished, `failed` after `max_attempts` (each error recorded),
  and `cancelled` when the operator asked to stop — interrupted runs are never shown
  as completed. Outreach always requires human approval before any contact.

## 7. Business Owner Mode

`/owner` is a separate, non-technical surface built on top of the same engines —
no agents, prompts, APIs, evidence models or score buckets are exposed.

- **Onboarding** — four plain questions (sell / location / ideal customers /
  goal). Goals come from a fixed catalog (`lib/owner/goals.js`); none is
  technical. Answers persist in `owner_profiles`.
- **Strategy** — `lib/owner/strategy.js` derives the internal search filters from
  the owner's own words: a sector guess (furniture → Events/Office/Restaurant/Hotel,
  healthcare → Healthcare/Office/Retail, …) picks target industries, plus the owner's
  location and keywords. The owner sees only the plain plan
  (`OWNER_STRATEGY_STEPS`) and the focus chips, never the filters.
- **Execution** — `POST /api/owner` enqueues a `DISCOVERY` job with
  `payload.owner_run = true`. The handler passes `bypassCapabilities`, so the
  software-provider capability gate is skipped: the owner's own product defines
  the fit rather than the solution library. Progress is rendered through
  `lib/owner/language.js` ("Looking for businesses that could be a good fit…").
- **Results** — completed runs map the real scored opportunities to
  `opportunity_result` cards: business name, plain "what we noticed", a friendly
  priority (High / Medium / Lower), and a reviewable message draft
  (`ownerMessage`) grounded in the owner's goal and the customer's situation.
  Sample datasets are badged as such.

Honesty holds here too: an owner run is `completed` only when the underlying
pipeline finished; zero matches is reported as "none matched closely enough yet",
not dressed up as success.
