# OpportunityOS

**Business Opportunity Intelligence Platform.** Discover businesses, research how they
operate from public information, identify evidence-backed problems, match them to
software you can deliver, estimate impact as clearly-labeled scenarios, score the
opportunity 0–100, and generate personalized outreach.

> A contact is NOT an opportunity. Opportunities require evidence of a real problem,
> a **money mechanism** (a plausible HOW money is made or saved), a matching solution,
> business maturity and contactability. Every opportunity carries a structured 4-part
> explanation (why it exists / what evidence supports it / how it affects money / what
> still needs confirming), and financial scenarios are built from that mechanism as
> clearly-labeled *illustrative* ranges. If evidence is weak the platform says so
> rather than inventing a problem.

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Start MariaDB/MySQL and configure .env
cp .env.example .env      # then edit credentials
#   e.g. with Docker:
docker run -d --name oos-mariadb -e MARIADB_ROOT_PASSWORD=root \
  -e MARIADB_DATABASE=opportunityos -p 127.0.0.1:3307:3306 mariadb:10.11
#   DATABASE_URL=mysql://root:root@127.0.0.1:3307/opportunityos

# 3. Apply migrations + seed (solution library, demo data, admin user)
node scripts/setup-db.js

# 4. Run
npm run dev               # http://localhost:3000
```

Default login after seeding: tenant `admin@example.com` / `opportunityos`, and the
platform admin (control room) is `admin@example.com` / `opportunityos` via
`/admin/login` — change both.

## Core workflow

Discover → Research & Evidence → Detect problems → Analyze (AI or rule engine) →
Financial scenario → Solution matching → Scoring (0–100) → Outreach draft →
Human review → Pipeline → Demo plan → Won/Lost.

The **12-stage opportunity pipeline** tracks every deal from first contact to close:
NEW → RESEARCHING → QUALIFIED → CONTACTED → REPLIED → DEMO → PROPOSAL →
NEGOTIATION → WON / LOST / NOT_A_FIT / NOT_A_SERVICE_FIT. Every status change
creates an activity event. Project value (what you could charge) is tracked
separately from business impact (what the business could gain). Weighted pipeline
= project value × stage probability.

**My Capabilities** — the `Settings → My Capabilities` section defines *your*
business: name, location, services, industries served, technologies, the
solutions you actually build (enable/disable per solution), a min/max project
value range, and preferred industries / locations / problem categories / client
size. The opportunity engine uses this profile: only **enabled** solutions are
ever recommended, and an opportunity whose problem no enabled solution can serve
is marked **NOT_A_SERVICE_FIT** (probability 0, nothing recommended, reason
recorded). Preferences only nudge fit scores — they never hard-block.

Discovery is job-based and duplicate-protected. Every long-running piece of work —
discovery runs, automated/AI research, opportunity analysis, financial scenarios,
solution matching, outreach drafts and demo specs — is a **background job** (see
`/jobs`). Each job lives in `background_jobs` and transitions
`queued → running → completed | failed | cancelled`, with real progress, stage,
attempts and error messages, a dedup hash (identical in-flight jobs are never
re-run), automatic retries up to `max_attempts`, and safe cancellation (queued
jobs cancel instantly; running jobs stop at a safe point). Progress is **never
fabricated** — a job is only `completed` when its handler has actually finished.
The queue is DB-backed behind `lib/jobs/queue.js`, which mirrors the BullMQ Job
API so Redis/BullMQ can replace the storage later without touching handlers or UI. Nothing
becomes a business until you review and import candidates; import
deduplicates across normalized name, website, phone and social handle, classifies
contacts via the ContactProvider, and imports source evidence with provenance.

**Business Owner Mode** — `/owner` is a completely non-technical view. A business
owner answers four plain questions (*What do you sell / Where do you operate / Who
are your ideal customers / What are you trying to achieve?*), the system quietly
derives an opportunity-finding strategy (target industries, location and keywords
from their own words), and runs the same DISCOVERY pipeline in the background. The
owner sees simple progress ("Looking for businesses that could be a good fit…") and
plain results — "16 opportunities found" — with a friendly reason and a reviewable
message draft for each business. No agents, prompts, APIs, evidence models, score
buckets or stage names appear. Owner runs bypass the software-provider capability
gate so the owner's own product offering (not the solution library) defines the fit.

**One-click discovery** — the `/discover` page is a non-technical "Find
opportunities" form (industry / location / platform / minimum audience / maturity /
problem categories / solutions). `POST /api/discover` enqueues a `DISCOVERY`
background job whose 8 real stages (discovering → researching →
checking_contacts → analyzing → identifying_opportunities → calculating_scenarios →
matching_solutions → ranking) drive a live progress bar that the client polls via
`GET /api/discover/jobs/[id]`. Progress is honest — it mirrors real job state
(`background_jobs.stage`), and on completion it returns a genuine summary (N businesses
researched / N had sufficient evidence / N strong opportunities) plus the ranked
opportunities, scored by the same engine used everywhere.

**Opportunity Detail** — `/opportunities/[id]` renders 12 numbered sections with a
Provenance Legend (fact / inference / hypothesis / financial assumption / estimated
project value / potential business impact) at the top:
1. Business context (industry, location, platform, followers, maturity)
2. Opportunity score with per-dimension breakdown and re-analyze
3. Problem type and explanation
4. Evidence with source, URL, claim type and confidence
5. Why this opportunity matters
6. Money opportunity with editable assumptions and scenario editor (low/base/high)
7. Recommended solution with features required, project value estimate and alternatives
8. Uncertainties
9. Personalized Outreach Engine (3 message variants with lifecycle actions)
10. Demo walkthrough generator
11. Pipeline with event history and status moves
12. Contact with verification status and source

**Concept Demo Generator** — `/opportunities/[id]` Section 10 generates a detailed
concept demo spec from 8 industry-specific templates (Furniture, Restaurant, Salon,
Hotel, Retail, Wholesale, Clinic, School). Templates are matched by the business's
industry, then the solution type. Each spec includes recommended pages with
descriptions, features to demonstrate, a step-by-step walkthrough, sample data
(fictional, clearly labeled), data structures, and customization points. Always
labeled "CONCEPT DEMO — a design specification, not the prospect's existing system."
AI enhancement is optional; template-based generation always works.

Research is coverage-driven: the workspace shows a live **research coverage** banner
(13 aspects) and never invents what is missing. `RESEARCH_PROVIDER=website` (default)
politely fetches the business's own site respecting robots.txt + rate limits;
`RESEARCH_PROVIDER=http` calls an operator endpoint (`RESEARCH_API_URL`); `manual`
is checklist-only. Automated findings become evidence with full provenance; a phone
is stored as WhatsApp **only** when a source explicitly publishes it as such.

## Dashboard

The home screen focuses on money-making, not raw lead counts. `lib/repositories/dashboard.js`
(`getDashboard()`) aggregates one payload for the page:

- **Metrics** — New, Hot (score ≥ 90 / `HOT`), a **business-impact pipeline** (sum of the
  illustrative annual impact across open opportunities) and a **project-value pipeline**
  (sum of recommended solution delivery value), Opportunities needing action, Demos
  generated, Proposals sent, and Won.
- **Opportunity feed** — rich ranked cards showing score + category, business, industry,
  location, problem, opportunity, money mechanism, illustrative impact range, recommended
  solution, delivery value, WhatsApp-verified status, demo-ready status, next action, and
  inline actions: **View · Generate message · Generate demo · Move pipeline**.

Business-impact and delivery-value figures are clearly-labeled estimates from your
assumptions and the solution library (currencies are surfaced per the dominant currency),
never quoted as facts.

## Platform admin control room

`/admin/*` is a platform-wide control room for the **whole system**, decoupled from
tenant accounts. It is gated by a separate identity (`admin_users` + the
`oos_admin_session` cookie) with its own login at `/admin/login`; it never reuses
tenant logins, and the legacy `users.is_superadmin` flag is NOT honored — only an
`admin_users` row plus this session unlock it. `requireSuperadmin()` live-checks
every admin page and `/api/admin/*` route; access is never grantable through any
account-management API. It has its own nav (`components/AdminShell`) — it is not
linked from the normal `AppShell`, and a non-admin is redirected to `/admin/login`.

- **Control room** (`/admin`) — system overview (gate test is PDFMSE17/18).
- **Accounts** (`/admin/accounts`) — every workspace across every tenant with plan,
  status, members and usage; the admin can suspend/reactivate, change plans, and
  **delete** a workspace permanently (transactional purge, audit retained) — all
  audited (`admin.account_suspended`, `admin.account_plan_changed`,
  `admin.account_deleted`…).
- **Billing plans** (`/admin/plans`) — CRUD for `billing_plans` (price, currency,
  active flag, per-plan limits). `internal`/`free` are protected; a plan in use
  cannot be deleted (PDFMSE via plans CRUD e2e).
- **API keys** (`/admin/api-keys`) — issue/revoke hashed platform API keys, shown
  once, used by the ingest webhook (`X-Opportunityos-Api-Key`) (PDFMSE14).
- **Customer care** (`/admin/customer-care`) — reach-out queue records per account.
- **System health** (`/admin/system`) — DB ping/latency, background worker liveness,
  job queue counts by status (matched exactly to `background_jobs`), stale running
  jobs, provider configuration (PDFMSE21/22).
- **Scoring thresholds** (`/admin/scoring`) — the platform's default opportunity
  score thresholds (hot/high/medium/low/reject) that every workspace without its own
  `app_settings` override inherits, plus the weighted dimensions, category legend and
  the accounts overriding them. Edits are validated (0–100, monotonic) and audited
  (`admin.scoring_defaults_updated`) (PDFMSE23/24).
- **Usage & cost** (`/admin/usage`) — current-period `account_usage` counters against
  each plan's `billing_plans` limits, plan rollup and per-account over/near-limit
  flags (billing is not yet implemented; the surface exists so it can be enforced
  later) (PDFMSE25/26).
- **Audit log** (`/admin/audit`) — the append-only `audit_logs` trail, newest first,
  filterable by action and entity type, with actor/entity/account/summary per row
  (PDFMSE27/28).

All control-room surfaces have e2e coverage (PDFMSE17–28) asserting the
superadmin-only gate (anonymous/tenant 401, admin-only 200, page never renders for
non-admins) and that reported data matches the underlying tables exactly.

## Guarantees built into the product

- **Evidence principle** – every claim carries source, URL, quote/summary, type,
  confidence and a `fact / inference / hypothesis` label. AI output is never stored
  as fact automatically.
- **Financial principle** – business impact is always an *illustrative scenario* with
  editable assumptions (`additional_orders × average_order_value`, …). Project value
  (what you could charge) is stored and displayed separately from client impact.
- **Contact rules** – only publicly available details; WhatsApp is never inferred
  from a phone number; marking outreach as sent requires a linked public contact;
  opt-out is terminal — no further automated messages.
- **No fake AI** – without `AI_API_KEY`/`AI_MODEL` the deterministic rule engine runs,
  AI jobs are recorded as `skipped_no_provider`, and the UI says exactly that.
- **Only what you can deliver** – with a "My Capabilities" profile saved, disabled
  solutions are never recommended, and unservable opportunities are marked
  `not_a_service_fit` instead of being pushed down the pipeline.
- **No invented research** – automated research only records what a source actually
  says; uncovered aspects stay missing rather than being guessed.

## AI engine (lib/ai/)

Provider-agnostic engine. Any OpenAI-compatible endpoint works; swapping providers
is an env change, never a code change:

```env
AI_API_KEY=...        # required for AI features — never hard-coded, never logged
AI_MODEL=gpt-4o-mini  # required
AI_BASE_URL=https://api.openai.com/v1   # optional override
AI_TIMEOUT_MS=60000
```

Structure: `provider.js` (abstraction + `generateStructured` validate→repair→fail),
`client.js` (transport: timeouts, transient retries with backoff, JSON extraction,
secret redaction), `schemas/` (strict validators per agent), `prompts/`
(safety-grounded prompt builders), `agents/`, `jobs.js` (ai_jobs audit).

Five agents: BUSINESS_RESEARCH · OPPORTUNITY_ANALYST · SOLUTION_MATCHING ·
OUTREACH · DEMO_SPEC.

Safety contract (enforced structurally by schemas + repositories):
- never fabricate facts/phones/WhatsApp/revenue/followers/branches/headcount/evidence
- every claim cites provided evidence ids; claims labeled FACT / INFERENCE / HYPOTHESIS
- insufficient evidence ⇒ `NO_STRONG_OPPORTUNITY` (never an invented problem)
- invalid structured output ⇒ exactly one repair attempt, then the job is marked failed
- without a key nothing is faked: jobs are recorded `skipped_no_provider`

Test suites:
- `GET /api/system/self-test` — repository tests (41 assertions: normalization incl.
  social handles, dedup, contact verification rules, WhatsApp rules, scoring engine
  math (weighted totals, per-dimension sub-scores, category classification + configurable
  thresholds, follower-cap), matching, assumptions/scenarios, pipeline, outreach
  approval, job lifecycle + duplicate protection, robots.txt parser, constants integrity)
- `GET /api/system/ai-test` — 5 offline schema-contract tests + 5 live agent tests on a
  controlled `[DEMO]` sample business (live tests only run when a provider is set)

Application code owns: database, validation, scoring formulas, financial
calculations, deduplication, job records, audit logs.

## Architecture

See `ARCHITECTURE.md`. Layout:

```
app/            pages + API route handlers (App Router, JS only)
components/     shared UI + interactive panels
lib/db.js       mysql2 pool (the only place SQL config lives)
lib/repositories/  one module per entity
lib/services/   discovery · research · analysis · outreach · ai
db/migrations/  versioned SQL migrations (see DATABASE.md)
scripts/        setup-db.js
```

## Verification performed

- `npm test` — 56 e2e tests pass (mock AI / research / discovery providers):
  PDFMS01–21 core workflow, PDFMSE01–16 negative & auth paths, PDFMSE17–28
  superadmin control room (gate + exact match against tables), PDFMSREPORT.
- `next build` and `eslint` clean
- Repository self-test: 41/41 passing against MariaDB 10.11
- AI offline contract tests: 5/5 passing (live agent tests blocked only by API quota)
- Full workflow smoke-tested against MariaDB 10.11 via the running server:
  login/register, job-based discovery search + import (name/phone/social dedup,
  WhatsApp stored only when explicitly published, phone_only otherwise, source
  evidence imported with provenance), research coverage banner + graceful failure
  on unreachable sites, deterministic problem detection, per-factor scoring
  (8 weighted dimensions → category + per-dimension "why this score" reasons),
  assumption editing + recalculation, project value separation, solution matching
  persistence, template outreach draft + send-guard, pipeline events, demo plan,
  WhatsApp-inference rejection, AI-not-configured states.
- **Personalized Outreach Engine** smoke-tested: generates 3 evidence-driven variants
  (short/normal/professional) from real opportunity data; lifecycle guards enforced
  (contacted requires approval, opt-out is terminal, contact requires public contact);
  pipeline events recorded on transitions; opt-out respected.
- **Opportunity Detail page** renders all 12 sections with provenance legend for
  opp 34 ([DEMO] Kilimanjaro Kreative Furniture, score 82/HIGH, 3 FACT evidence
  rows, WhatsApp contact verified).
- **Concept Demo Generator** smoke-tested on opp 34 (Furniture business, E-commerce
  solution): correctly matches Furniture & Woodwork template, produces 9 pages, 15
  features, 11-step walkthrough, 4 sample data entities with data structures, 7
  customization points, clearly labeled "CONCEPT DEMO".
- **Opportunity Pipeline** smoke-tested: 11-stage Kanban (9 columns with items),
  status transitions with probability auto-calculation (researching→qualified = 30%),
  project value + weighted pipeline (KES 150K × 30% = KES 45K), activity log
  created on every transition, pipeline metrics API returns totals, opportunity
  detail page Section 11 shows project value / probability / weighted / timeline.
- **My Capabilities** smoke-tested: profile saved via `PATCH /api/settings/capabilities`
  (name, location, services, industries, technologies, solution toggles, pricing
  range, preferred targets); solution matching gates on enabled solutions (disabled
  School Management excluded); preference boosts (preferred industry lifts fit,
  over-max pricing penalizes commercial fit); full flow verified end-to-end — a
  dental clinic's booking problem with a POS-only profile was created and marked
  `not_a_service_fit` (probability 0, no recommended solution, reason in notes +
  activity log) via `POST /api/businesses/[id]/detect-opportunities`.
- Money-focused dashboard renders live metrics (new/hot/need-action/proposals/won/
  demos + business-impact & project-value pipelines, validated against row counts and
  project/scenario tables) and the ranked opportunity feed with inline View / Generate
  message / Generate demo / Move pipeline actions.
