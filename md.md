# OpportunityOS — Full System Report

**Version**: 0.1.0  
**Stack**: Next.js 16.3.2 (App Router), React 19, Tailwind 4, MariaDB/MySQL (live), PostgreSQL (target schema via migrations), mysql2 / pg drivers  
**Entry**: `next dev` / `next start`  
**Tests**: `npm test` → 56 e2e tests with mock AI, research & discovery services  

---

## 1. Mission

OpportunityOS is a multi-tenant SaaS that helps service providers (software agencies, consultants) discover, qualify and act on commercial opportunities for their potential clients. The platform:

* Discovers real businesses via configurable providers or a webhook
* Researches them with structured evidence (website scraping, AI analysis)
* Detects problems from evidence signals
* Scores opportunities (deterministic 8-dimension engine)
* Computes financial scenarios
* Matches solutions from a configurable library
* Generates outreach messages (AI or deterministic, with approval workflow)
* Tracks the whole pipeline from "new" to "won"

The whole system is **no-fabrication by design**: every claim is grounded in on-file evidence with provenance; the AI layer has a structured-output contract and never invents data when unavailable.

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  Frontend (React Server Components + client components, Tailwind)    │
│  app/login · discover · owner · opportunities · pipeline · jobs ...  │
├──────────────────────────────────────────────────────────────────────┤
│  API layer  (app/api/**/route.js — 37 REST endpoints)               │
├──────────────────────────────────────────────────────────────────────┤
│  Core services                                                        │
│  ├ discovery  ├ research  ├ analysis  ├ outreach  ├ demo            │
│  └ providers   └ website    └ scoring   └ outreach   └ templates    │
│                        + financial scenarios + solution matching      │
├──────────────────────────────────────────────────────────────────────┤
│  AI layer                                                             │
│  ├ ai/client.js        (OpenAI-compatible transport, retries)       │
│  ├ ai/provider.js      (structured output + schema repair)          │
│  ├ ai/agents/*         (5 agents: research, analyst, matching, ...) │
│  ├ ai/schemas/*        (JSON schemas + validation)                  │
│  └ ai/prompts/*        (system prompts per agent)                   │
├──────────────────────────────────────────────────────────────────────┤
│  Background jobs                                                      │
│  ├ lib/jobs/queue.js   (DB-backed queue, SKIP LOCKED, dedup)       │
│  ├ lib/jobs/worker.js  (single-long-poll loop, one job at a time)   │
│  ├ lib/jobs/scheduler.js (watches → due schedules → DISCOVERY jobs) │
│  └ lib/jobs/handlers/* (8 job-type handlers)                        │
├──────────────────────────────────────────────────────────────────────┤
│  Infrastructure                                                       │
│  ├ lib/db.js           (mysql2 pool, parseJson, query/insert)       │
│  ├ lib/auth.js         (sessions, scrypt passwords, register/login) │
│  ├ lib/accounts/usage.js (per-period counters + plan limits)        │
│  ├ lib/api-helpers.js  (requireUser, requireAccount, readJson, ...) │
│  ├ lib/rate-limit.js   (in-memory fixed-window, per-IP)             │
│  ├ lib/audit.js        (append-only audit_logs)                      │
│  └ db/migrations/       (20 Postgres-flavored SQL files)            │
├──────────────────────────────────────────────────────────────────────┤
│  Live DB: MariaDB at DATABASE_URL  (mysql://...)                    │
│  Future target: PostgreSQL (migrate.js uses pg, migration files are │
│  Postgres-flavored; applied via scripts/setup-db.js → migrate.js)    │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Model (MySQL tables)

The live MariaDB database contains 30 tables, all tenant-scoped via `account_id`:

| Table | Purpose |
|---|---|
| `accounts` | Workspaces: id, name, plan_code (free/pro/internal), status (active/suspended) |
| `users` | Account members: email, password_hash (scrypt), role (owner/admin/member), account_id, status |
| `sessions` | Session tokens (14-day TTL, httpOnly cookie) |
| `businesses` | Discovered or imported businesses (per-account) |
| `business_contacts` | Public contacts (email/phone/whatsapp/social) with verification_status |
| `business_evidence` | Evidence rows: claim_type (FACT/INFERENCE/HYPOTHESIS), signal_key, confidence_score |
| `business_sources` | Provenance: source_type, source_url, external_identifier |
| `opportunities` | Detected opportunities: problem_type, score_category, opportunity_score, assignee_id, status |
| `opportunity_evidence` | Links opportunity ↔ evidence |
| `opportunity_assumptions` | Financial assumption triples (value / low / high) |
| `opportunity_solutions` | Solution matching results: 4 fit sub-scores + project value + why |
| `solutions` | Solution library: configurable pricing, solves_problem_types, industries |
| `solution_industries` / `solution_problems` | Junction tables for solution dimensions |
| `financial_scenarios` | Scenario calculations: formula key, assumptions, impact_low/high, currency, period |
| `outreach_messages` | 3 WhatsApp variants per opportunity: lifecycle_status, approved flag, opted_out_at |
| `pipeline_events` | Audit trail for pipeline transitions: from_status, to_status, notes |
| `search_queries` | Saved discover queries (industry, location, platform, etc.) |
| `search_jobs` | Metadata for saved search runs |
| `background_jobs` | Job queue: type, status, payload (JSON), dedup_key, attempts, result, stage, progress |
| `ai_jobs` | AI invocation log (type, duration_ms, model, input/output token estimates) |
| `account_usage` | Period counters: researches_used, opportunities_used, ai_analyses_used, demo_generations_used, users_used |
| `billing_plans` | Plan definitions: limit_researches, limit_opportunities, limit_ai_analyses, limit_demo_generations, limit_users, **limit_watches** |
| `app_settings` | Key-value per-account settings (score_thresholds, provider config) |
| `user_capabilities` | Owner's own business profile (services, preferred industries, solution_types) |
| `owner_profiles` | Owner Mode answers (sell_what, ideal_customers, goals, strategy JSON) |
| `discover_schedules` | Recurring watch schedules: provider, filters_json, interval_minutes, next_run_at, enabled |
| `activity_log` | Activity events (activity_type, title, opportunity_id, assigned_user_id) |
| `audit_logs` | Append-only audit trail |

---

## 4. Pipeline Flow (End-to-End)

### 4.1 Discovery (`lib/services/discovery/`)

Businesses enter via one of:

| Provider | Env var | Notes |
|---|---|---|
| `manual` | — | User adds businesses by hand |
| `http` | `DISCOVERY_API_URL` | POST filters → results |
| `feed` | `SOCIAL_MEDIA_FEED_URL` | Pull-based licensed lead source |
| `google_places` | `GOOGLE_PLACES_API_KEY` | Google Places Text Search (Phase 2) |
| *webhook* | `OPPORTUNITYOS_INGEST_TOKEN` + `OPPORTUNITYOS_INGEST_ACCOUNT_ID` | Real-time POST /api/leads/webhook (token-bound to one account, header ignored) |
| `osm-overpass` | *(built, not wired)* | OpenStreetMap Overpass API, returns PUBLIC Phone businesses (Phase 2b) |

`importCandidates` / `ingestLeads` (`lib/services/discovery/index.js`): normalizes name/website/phone/social, deduplicates across 4 signals, attaches evidence with provenance, classifies contacts through the `ContactProvider`.

### 4.2 Research (`lib/services/research/`)

* `lib/services/research/website-provider.js`: HTTP-fetches the business homepage (polite-fetcher, timeout 10s), extracts structured evidence with signal_key mappings
* AI `business-research` agent produces a `BusinessResearchProfile`: problem_signals, opportunity_signals, financial_signals, contactability_score
* Evidence rows are persisted with claim_type (FACT/INFERENCE/HYPOTHESIS) and confidence
* `lib/services/research/coverage.js`: determines whether research is sufficient for opportunity detection

### 4.3 Opportunity Detection (`lib/services/analysis/rules-analyzer.js`)

Purely deterministic (no AI). Reads on-file evidence, maps signal_keys → problem_types using `SIGNAL_KEYS` and `PROBLEM_TYPES` from `lib/constants.js` (21 problem types, 29 signal keys). Thresholds are severity-weighted.

### 4.4 Analysis & Scoring (`lib/services/analysis/`)

**Financial engine** (`scenarios.js`): maps a money_mechanism_key (11 mechanisms: additional_sales, higher_conversion, repeat_sales, labor_savings, etc.) to a formula and required assumptions. Creates a triple: low/base/high values with low/high impact.

**Solution matching** (`matching.js`): 4-fit scoring (problem_fit, industry_fit, technical_fit, commercial_fit) against the solution library. Configurable project value ranges from the library's pricing config. Ranked by fit_score + recommended flag.

**Scoring engine** (`scoring.js`): 8 weighted dimensions (evidence 0.20, problem 0.15, money 0.15, solution_fit 0.15, maturity 0.10, ability_to_pay 0.10, complexity 0.10, contactability 0.05). Overall score 0–100. Categories: **HOT** ≥ 90, **HIGH** ≥ 80, **MEDIUM** ≥ 65, **LOW** ≥ 50, **REJECT** < 50. Thresholds are configurable via `app_settings` (`lib/repositories/settings.js`).

Follower count is explicitly never a scoring dimension; it is only a small capped supporting signal inside ability_to_pay reasons.

### 4.5 Demo Generation (`lib/services/demo/`)

AI agent produces a `DemoConcept`: architecture_diagram (ASCII), user_flow (5 steps), key_screens (3 screen texts). Fall back to deterministic template if AI is unavailable. Stored with `ai_model` provenance tag.

### 4.6 Outreach (`lib/services/outreach/`)

**Personalized Outreach Engine**: three WhatsApp message variants:
- **short** (casual)
- **normal** (friendly-professional)
- **professional** (formal)

All follow a P-12 structure: natural intro → specific evidence-grounded observation → specific problem → simple solution → low-pressure CTA. Uses the strongest on-file FACT or INFERENCE as the observation. Hypothesis evidence is never used in outreach.

**Lifecycle**: `generated` → (human) `approved` → `contacted` → `replied` → `proposal` → `won` / `lost`. Recipient opt-out stops all future outreach (HTTP 409 "opted out"). Approval is mandatory before contacting.

### 4.7 Pipeline Tracking

Pipeline statuses: `new → researching → qualified → contacted → replied → demo → proposal → negotiation → won / lost / not_a_fit / not_a_service_fit`.

Transitions are logged to `pipeline_events` with notes and `actor_user_id`. The `opportunity.feed_card` and `pipeline.page` views surface this timeline.

---

## 5. Background Jobs (`lib/jobs/`)

### Queue (`queue.js`)

DB-backed, compatible with a future swap to Redis/BullMQ. Features:
- `enqueue`: deduplication via `dedup_key` (sha256 of type + params); duplicate runs return the existing job
- `claimNext`: `SELECT … FOR UPDATE SKIP LOCKED` (safe for multiple workers)
- `requestCancel`: queued jobs cancelled immediately; running jobs get a flag checked at safe points
- `fail`: requeues while `attempts < max_attempts` (default 3)

### Worker (`worker.js`)

Single-long-poll loop (pollMs=750). Claims one job at a time. Delegates to handler in `lib/jobs/handlers/`.

### Registry (`registry.js`)

8 job types, each with its own handler:

| Job type | Handler | Description |
|---|---|---|
| `DISCOVERY` | `discovery.js` | Full pipeline: discover → research → analyze → score → match |
| `RESEARCH` | `research.js` | Single-business research |
| `AI_RESEARCH` | `ai-research.js` | AI business-research agent |
| `OPPORTUNITY_ANALYSIS` | `opportunity-analysis.js` | AI + financial analysis of an opportunity |
| `FINANCIAL_ANALYSIS` | `financial-analysis.js` | Financial scenario computation |
| `SOLUTION_MATCHING` | `solution-matching.js` | Solution library matching |
| `OUTREACH_GENERATION` | `outreach-generation.js` | 3 WhatsApp variant generation |
| `DEMO_GENERATION` | `demo-generation.js` | AI demo concept generation |

### Scheduler (`scheduler.js`)

Ticks every 15 seconds in the background worker's Node process. Finds due `discover_schedules` (enabled, next_run_at ≤ NOW), advances `next_run_at` immediately (no hot-loop on transient failures), checks plan caps (`researches` + `opportunities`), then enqueues a `DISCOVERY` job per schedule.

---

## 6. Owner Mode (`lib/owner/`, `app/owner/`)

A guided plain-language experience for business owners (no technical vocabulary exposed).

**Flow**: answer 4 questions (sell_what, location, ideal_customers, goals) → system builds a strategy (filters) → "Start looking for opportunities" → background DISCOVERY run → results in plain English.

**Components**:
- `lib/owner/goals.js`: goal definitions (increase_revenue, reduce_costs, etc.)
- `lib/owner/strategy.js`: builds the strategy (filters, focus industries, steps)
- `lib/owner/language.js`: translates opportunity scores/statuses to plain-English labels and tone
- `components/OwnerMode.js`: full React client (setup → plan → running → results)
- `lib/repositories/owner.js`: owner profile + job queries (owner_run=true in payload)

**Result card**: shows priority label (Hot / High priority), observation, why_it_matters, and a "Draft a message" action that pre-generates a WhatsApp outreach draft.

**Watch creation (Phase 5, step 2)**: on the results page, a "Keep watching for opportunities like this" block lets the user turn a completed owner run into a recurring watch. The button POSTs to `/api/discover/schedules` with the saved `strategy.filters`, subject to the plan's active watch cap (free=3, pro=25).

---

## 7. Auth & Multi-Tenancy

### Session Management (`lib/auth.js`)

- Cookie: `oos_session`, httpOnly, sameSite=lax, 14-day TTL
- Passwords: scrypt with 16-byte random salt (N=16384, r=8, p=1)
- `getCurrentUser()`: joins sessions → users, returns `{id, email, name, role, account_id, status}`
- `register()`: creates a free-plan workspace (account), sets the signer as OWNER
- `login()`: standard email + password verification

### API Guardrails (`lib/api-helpers.js`)

- **`requireUser()`**: returns the user or throws 401. Now also rejects suspended users (status !== 'active') with 403 "Account suspended" (Phase 4, issue 5 — defense-in-depth).
- **`requireAccount()`**: calls requireUser + checks user belongs to a non-suspended account. Owns account-scoped queries.
- **`requireRole(user, 'admin')`**: throws 403 if the user is below the requested role level. Used on solution library CRUD, score threshold changes, team management.
- **`isMember(user)`**: true if role === 'member'. Members are restricted to opportunities with `assignee_id = user.id` on: PATCH opportunities, analyze, demo-spec, outreach, and pipeline/activity endpoints (Phase 4, issue 3).

### Ingress Token (`OPPORTUNITYOS_INGEST_TOKEN`)

Used only by `POST /api/leads/webhook`. The token is bound server-side to exactly one account via `OPPORTUNITYOS_INGEST_ACCOUNT_ID`. The client `X-Opportunityos-Account` header is ignored (Phase 4, issue 2). Module-load throw if the env is misconfigured. Suspended bound accounts are rejected with 403 before any ingestion (Phase 4, issue 1).

### Account Suspension

A suspended account is blocked at every tenant-scoped route:
- `requireUser()` rejects suspended *users* → 403 (Phase 4, issue 5)
- `requireAccount()` checks account status → 403
- Webhook token path checks `getAccount()` status → 403 (Phase 4, issue 1)

---

## 8. Plan Limits & Usage (`lib/accounts/usage.js`)

Period-based counters in `account_usage` (keyed by `YYYY-MM`), with enforcement at the request boundary via `assertWithinLimit()`.

| Usage key | Billing plan column | Free limit | Pro limit | Internal limit |
|---|---|---|---|---|
| `researches` | `limit_researches` | 50 | 500 | ∞ |
| `opportunities` | `limit_opportunities` | 200 | 2,000 | ∞ |
| `ai_analyses` | `limit_ai_analyses` | 50 | 500 | ∞ |
| `demo_generations` | `limit_demo_generations` | 20 | 200 | ∞ |
| `users` | `limit_users` | 5 | 25 | ∞ |
| **`watches`** | `limit_watches` | **3** | **25** | ∞ |

`incrementUsage(key, units)` is called at key pipeline points (research, opportunity detection, analysis, demo). `assertWithinLimit()` returns HTTP 403 with a human-readable message when the cap is hit.

### Active Watch Cap (Phase 5)

Unlike the period counters, watches use a **concurrent cap**: `watchLimitStatus()` counts `enabled = 1` rows in `discover_schedules`. Pausing a watch (enabled → 0) frees a slot immediately.

---

## 9. Rate Limiting (`lib/rate-limit.js`)

In-memory fixed-window, per-IP. Throws `HttpError(429)` with a `retryAfterMs` hint. Applied to:

| Route | Window | Limit |
|---|---|---|
| `POST /api/auth/login` | 15 min | 10 |
| `POST /api/auth/register` | 60 min | 10 |
| `POST /api/discover` | 60 min | 30 |
| `POST /api/jobs` | 60 min | 30 |
| `POST /api/leads/webhook` | 60 min | 600 |
| `POST /api/businesses/[id]/research` | 60 min | 30 |
| `POST /api/businesses/[id]/interpret` | 60 min | 60 |
| `POST /api/businesses/[id]/detect-opportunities` | 60 min | 60 |
| `POST /api/opportunities/[id]/analyze` | 60 min | 60 |
| `POST /api/opportunities/[id]/outreach` | 60 min | 20 |
| `PATCH /api/outreach/[id]` | 60 min | 120 |

Note: all limits are per-process; multi-instance deployments need a shared store (Redis etc.).

---

## 10. AI Layer (`lib/ai/`)

### Transport (`ai/client.js`)

OpenAI-compatible `/chat/completions` endpoint. Bearer token from `AI_API_KEY`. Timeout: `AI_TIMEOUT_MS` (default 60s). Auto-retries on 408/429/5xx (3 attempts, backoff 400ms/800ms). JSON mode by default.

### Provider (`ai/provider.js`)

Single entry point: `aiProvider.generateStructured({ system, user, schema })`. Contract:
1. Call model with JSON mode
2. Validate against the agent's JSON schema
3. If invalid → one repair attempt (error messages fed back to the model)
4. Still invalid → `{ ok: false, reason: 'invalid' }` — never fabricates a fallback
5. If not configured → `{ ok: false, reason: 'not_configured' }`

### Agents (5)

Each agent wires a prompt template + JSON schema + validation:

| Agent | File | Output schema |
|---|---|---|
| `business-research` | `ai/agents/business-research.js` | `BusinessResearchProfile` |
| `opportunity-analyst` | `ai/agents/opportunity-analyst.js` | `OpportunityAnalysis` |
| `solution-matching` | `ai/agents/solution-matching.js` | `SolutionMatch` |
| `demo-spec` | `ai/agents/demo-spec.js` | `DemoSpec` |
| `outreach` | `ai/agents/outreach.js` | `OutreachDrafts` (3 variants) |

Schemas are in `ai/schemas/` with JSON-schema validation and `util.js` helpers. Prompts are in `ai/prompts/`.

`ai/jobs.js` logs every AI invocation to `ai_jobs` with model, tokens, duration.

---

## 11. Settings & Configuration

### Score Thresholds (`app_settings`)

Configurable per-account via `lib/repositories/settings.js`:
```
{ hot: 90, high: 80, medium: 65, low: 50 }
```
Editable at `/settings` (admin-only, via `score-thresholds` route). When not set, the defaults from `lib/constants.js` are used.

### User Capabilities (`user_capabilities`)

The owner's own business profile: services, industries_served, technologies, solution_types, preferred_industries/locations/problem_categories, min/max project value. Used to filter recommendations (only build what the user actually ships) and to flag NOT_A_SERVICE_FIT opportunities.

---

## 12. Frontend Pages & Components

### Pages (`app/`)

| Path | Description |
|---|---|
| `/login` / `/register` | Auth |
| `/` | Dashboard (account overview, team) |
| `/account` | Account settings (name, plan, team) |
| `/analytics` | Dashboard analytics |
| `/businesses` | Business list + add form |
| `/discover` | One-click discovery, watch management, webhook docs |
| `/jobs` | Background job queue + progress |
| `/opportunities` | Opportunity feed (cards with ScoreBadge, ProblemTag) |
| `/opportunities/[id]` | Opportunity detail (evidence, financial, solutions, outreach, pipeline) |
| `/owner` | Owner Mode (guided, plain-language) |
| `/pipeline` | Kanban board (pipeline stages) |
| `/settings` | Score thresholds, capabilities |
| `/solutions` | Solution library CRUD (admin-only) |

### Client Components (`components/`)

26 components covering: auth forms, discover flow, owner mode, pipeline kanban, opportunity cards/controls/panels, outreach engine, solution library manager, capabilities form, score threshold editor, team manager, demo concept viewer, activity timeline, job progress client, provenance tags, UI primitives (Card, ScoreBadge, StatusBadge, ProblemTag, fmtMoney).

---

## 13. API Routes (37 endpoints)

| Route | Methods | Purpose |
|---|---|---|
| `/api/auth/register` | POST | Create workspace + owner |
| `/api/auth/login` | POST | Session login |
| `/api/auth/logout` | POST | Destroy session |
| `/api/account` | GET | Account + usage + limits + team |
| `/api/account/members/[userId]` | PATCH, DELETE | Manage team (admin only) |
| `/api/businesses` | GET, POST | List/create businesses |
| `/api/businesses/[id]` | GET, PATCH, DELETE | Business detail/update |
| `/api/businesses/[id]/evidence` | GET, POST | Business evidence |
| `/api/businesses/[id]/contacts` | GET, POST | Business contacts |
| `/api/businesses/[id]/research` | POST | Trigger research (rate limited) |
| `/api/businesses/[id]/interpret` | POST | AI interpretation (rate limited) |
| `/api/businesses/[id]/detect-opportunities` | POST | Rule-based opportunity detection |
| `/api/opportunities` | GET | List opportunities |
| `/api/opportunities/[id]` | GET, PATCH | Opportunity detail/update (ownership guard) |
| `/api/opportunities/[id]/analyze` | POST | AI + financial analysis (ownership guard) |
| `/api/opportunities/[id]/demo-spec` | POST | AI demo concept (ownership guard) |
| `/api/opportunities/[id]/outreach` | POST | Generate outreach drafts (ownership guard) |
| `/api/outreach/[id]` | PATCH | Outreach lifecycle actions |
| `/api/solutions` | GET, POST | Solution library (admin) |
| `/api/solutions/[id]` | GET, PATCH, DELETE | Solution detail (admin) |
| `/api/pipeline` | GET | Pipeline list (all opportunities) |
| `/api/pipeline/activity` | POST | Log pipeline event (ownership guard) |
| `/api/evidence/[id]` | DELETE | Delete evidence |
| `/api/discover` | GET, POST, PUT | One-click discovery + manual import |
| `/api/discover/jobs/[id]` | GET | Job progress + results |
| `/api/discover/jobs/[id]/cancel` | POST | Cancel discovery job |
| `/api/discover/schedules` | GET, POST | List/create watch schedules |
| `/api/discover/schedules/[id]` | PATCH, DELETE | Update/delete watch |
| `/api/jobs` | GET, POST | List/enqueue background jobs |
| `/api/jobs/[id]` | GET | Job detail |
| `/api/jobs/[id]/cancel` | POST | Cancel job |
| `/api/jobs/[id]/retry` | POST | Retry failed job |
| `/api/leads/webhook` | POST | Real-time lead ingestion (token-auth) |
| `/api/owner` | GET, POST | Owner Mode (profile + run) |
| `/api/settings` | GET, PATCH | App settings (per-account) |
| `/api/settings/capabilities` | GET, PATCH | User capabilities |
| `/api/settings/score-thresholds` | GET, PATCH | Score thresholds (admin) |
| `/api/system/self-test` | POST | 43-assertion self-test (admin) |
| `/api/system/ai-test` | POST | AI transport diagnostic |

---

## 14. Security Summary

### Request-boundary guards (per-route)

- **Rate limiting**: in-memory, per-IP, fixed-window (11 protected routes)
- **Plan limits**: `assertWithinLimit` at point of expensive work (discover, webhook, research, detect, analyze, demo-spec, jobs). Free-plan users cannot bypass via repeated runs.
- **Watch cap**: `assertWithinWatchLimit` on schedule creation (concurrent active-watches cap)
- **Role checks**: `requireRole(user, 'admin')` on solution library, score thresholds, team management

### Ownership guards (members)

Members (`role === 'member'`) can only view/edit opportunities where `assignee_id = user.id`. Enforced at:
- `PATCH /api/opportunities/[id]`
- `POST /api/opportunities/[id]/analyze`
- `POST /api/opportunities/[id]/demo-spec`
- `POST /api/opportunities/[id]/outreach`
- `PATCH /api/outreach/[id]`
- `POST /api/pipeline/activity`

### Suspended-account lockout (Phase 4, all 5 issues fixed)

1. `requireUser()` itself now rejects suspended *users* → 403 "Account suspended"
2. `requireAccount()` additionally checks account status → 403
3. Webhook token path checks `getAccount(tokenAccountId).status !== 'active'` → 403 before ingestion
4. `accountFromToken()` ignores the client `X-Opportunityos-Account` header; token is env-bound to one account
5. `POST /api/pipeline/activity` fetches the opportunity and verifies ownership before writing

### Auth password handling

Scrypt (N=16384, r=8, p=1, 64-byte hash) with `crypto.timingSafeEqual`. Password never logged.

---

## 15. Tests

### Self-Test (`POST /api/system/self-test`)

43 inline assertions, admin-only. Covers:
- Normalization (business name, phone, social handle, email)
- Business CRUD + dedup
- Evidence (claim types, signal detection, hypothesis exclusion)
- Opportunity creation + 8-dimension scoring (verifies weights, category classification, follower-cap rule)
- Solution matching (4 fit scores, project value from library)
- Solution library CRUD
- Financial engine (6 formulas: additional_revenue, improved_conversion, repeat_sales, labor_savings, reduced_stock_loss, capacity_utilization)
- Pipeline transitions
- Outreach generation (2 evidence-anchored, 1 non-revenue scenario)
- Outreach lifecycle (approve → sent → opted_out)
- Demo spec generation
- Test assertions structure (implemented / tested / passed matrix)
- Provider/analysis metadata tracking

Returns: `{ ok: true, count: 43, summary: "43/43 passed", data: [...] }`

### E2E Suite (`npm test` → `scripts/run-e2e.mjs` → `node --test test/`)

38 tests against a live `next dev` server with 3 mock services (mock-ai, mock-research, mock-discovery):

| Group | Count | Coverage |
|---|---|---|
| PDFMS01–PDFMS19 (positive flow) | 19 | Register, solution library, business, evidence, contacts, research, AI interpret, opportunity detect, evidence attach, financial, scoring + solution match, outreach, outreach lifecycle, manual pipeline, discover job, jobs + AI model, webhook, scheduled watch |
| PDFMSE01–PDFMSE12 (negative / error paths) | 12 | 401, 400, 404, 409, insufficient evidence, no solution, no contact, AI invalid JSON, AI 500, research outage, plan limits, login rate-limiting |
| PDFMSE13 (self-test) | 1 | Admin-only self-test: 43/43 |
| PDFMSE14 (token auth) | 1 | Ingest token account-bound + suspended account rejection |
| PDFMSE15 (activity ownership) | 1 | Members blocked on unassigned opportunities |
| PDFMSE16 (suspended lockout) | 1 | Suspended users blocked on requireUser + requireAccount |
| PDFMS20 (watch limits) | 1 | Owner strategy → bounded recurring watch, plan cap, duplicate name rejection, pause frees slot |
| PDFMSREPORT (matrix) | 1 | Implemented / tested / passed coverage matrix |
| **Total** | **38** | |

### Other Scripts

- `scripts/test-osm-overpass.mjs`: standalone test of the OSM Overpass provider (25 candidates, 21 public-Phone)
- `scripts/mock-ai.mjs`, `scripts/mock-research.mjs`, `scripts/mock-discovery.mjs`: deterministic mock services for the e2e harness
- `scripts/setup-db.js`: applies migrations + seeds admin user (Postgres)
- `scripts/migrate.js`: incremental Postgres migration runner

---

## 16. Key File Index

| Path | Purpose |
|---|---|
| `lib/db.js` | MySQL pool, query helpers, parseJson |
| `lib/auth.js` | Sessions, scrypt, register/login |
| `lib/api-helpers.js` | requireUser, requireAccount, readJson, HttpError, handleRouteError |
| `lib/accounts/usage.js` | Period counters, plan limits, assertWithinLimit, assertWithinWatchLimit |
| `lib/accounts/roles.js` | isAtLeast, isMember, role hierarchy |
| `lib/rate-limit.js` | In-memory fixed-window rate limiter |
| `lib/constants.js` | Problem types, signal keys, scoring weights, categories, pipeline statuses |
| `lib/normalize.js` | Business name normalization, phone E.164, social handle normalization |
| `lib/validation.js` | isEmail, isUrl, isNonEmptyString |
| `lib/audit.js` | Append-only audit log writer |
| `lib/services/discovery/index.js` | Provider registry, importCandidates, ingestLeads (webhook) |
| `lib/services/discovery/pipeline.js` | DISCOVERY orchestration (full lifecycle) |
| `lib/services/discovery/providers/google-places.js` | Google Places Text Search (Phase 2) |
| `lib/services/discovery/providers/osm-overpass.js` | OSM Overpass (built, not wired; Phase 2b) |
| `lib/services/research/` | Website provider, polite-fetcher, coverage, research runner |
| `lib/services/analysis/rules-analyzer.js` | Evidence → problem type mapping |
| `lib/services/analysis/scoring.js` | 8-dimension weighted scoring engine |
| `lib/services/analysis/scenarios.js` | Financial scenario engine (11 mechanisms) |
| `lib/services/analysis/matching.js` | 4-fit solution matching |
| `lib/services/outreach/index.js` | 3-variant WhatsApp draft builder, approval + lifecycle |
| `lib/services/demo/index.js` | AI demo concept generator |
| `lib/ai/client.js` | OpenAI-compatible transport (retries, timeout) |
| `lib/ai/provider.js` | Structured output with schema repair |
| `lib/ai/agents/*.js` | 5 agent wrappers |
| `lib/ai/schemas/*.js` | JSON schemas + validation |
| `lib/jobs/queue.js` | DB-backed job queue (dedup, SKIP LOCKED, cancel) |
| `lib/jobs/worker.js` | Background worker loop |
| `lib/jobs/scheduler.js` | Watch schedule → DISCOVERY job |
| `lib/jobs/handlers/*.js` | 8 job-type handlers |
| `lib/owner/` | Owner Mode: goals, strategy builder, language/labels |
| `lib/repositories/*.js` | 14 data-access modules (businesses, opportunities, solutions, ...) |
| `app/api/**/route.js` | 37 API endpoints |
| `components/*.js` | 26 React client components |
| `db/migrations/*.sql` | 20 Postgres-flavored migration files (001–021) |
| `scripts/run-e2e.mjs` | E2E orchestrator (mocks + app + test runner) |

---

## 17. Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | MySQL DSN (live) |
| `AI_API_KEY` | For AI features | — | OpenAI-compatible API key |
| `AI_MODEL` | For AI features | — | Model name |
| `AI_BASE_URL` | No | `https://api.openai.com/v1` | AI endpoint |
| `AI_PROVIDER` | No | — | Label only (openai-compatible / mock) |
| `AI_TIMEOUT_MS` | No | `60000` | AI request timeout |
| `DISCOVERY_API_URL` | No | — | Operator discovery endpoint |
| `SOCIAL_MEDIA_FEED_URL` | No | — | Social/lead feed endpoint |
| `GOOGLE_PLACES_API_KEY` | No | — | Google Places Text Search |
| `GOOGLE_PLACES_API_URL` | No | `https://maps.googleapis.com/...` | Places API base |
| `GOOGLE_PLACES_DETAILS_URL` | No | `https://maps.googleapis.com/...` | Places Details API |
| `GOOGLE_PLACES_LANGUAGE` | No | `en` | Language for results |
| `GOOGLE_PLACES_MAX_RESULTS` | No | `10` | Max candidates per search |
| `GOOGLE_PLACES_FETCH_DETAILS` | No | `1` | Fetch detailed place info |
| `GOOGLE_PLACES_MIN_INTERVAL_MS` | No | `500` | Min interval between requests |
| `OPPORTUNITYOS_INGEST_TOKEN` | No | — | Webhook auth token (bound to one account) |
| `OPPORTUNITYOS_INGEST_ACCOUNT_ID` | If token set | — | Account ID the token is bound to |
| `SESSION_SECRET` | No | — | For future session signing |
| `APP_URL` | No | — | Public URL for outreach links |

---

## 18. Development Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Production build (verified: builds successfully) |
| `npm run lint` | ESLint (verified: passes clean) |
| `npm test` | Full e2e suite (starts mocks + next dev + runs tests + tears down) |
| `node scripts/setup-db.js` | Apply migrations + seed admin (Postgres target) |
| `node scripts/test-osm-overpass.mjs` | Standalone OSM Overpass test |

---

## 19. Development Phases Summary

### Phase 1 — Postgres Migration (paused)

Rewrote all migration files from MySQL to Postgres-flavored DDL (IDENTITY, JSONB, ON CONFLICT, ALTER TABLE ADD COLUMN IF NOT EXISTS). `db/migrations/` files are now Postgres-compatible. `scripts/migrate.js` and `scripts/setup-db.js` use `pg`. The live runtime remains on MariaDB (`lib/db.js` uses mysql2, `DATABASE_URL` points to MySQL). Paused before rewriting `lib/db.js` itself.

### Phase 2 — Google Places Discovery (complete)

Added `lib/services/discovery/providers/google-places.js`: Google Places Text Search with optional detail enrichment (`GOOGLE_PLACES_FETCH_DETAILS`), min-interval delay (`GOOGLE_PLACES_MIN_INTERVAL_MS`), and configurable max results. Wired into the provider registry in `lib/services/discovery/index.js`. Lint + build pass.

### Phase 2b — OSM Overpass Provider (built, not wired)

Added `lib/services/discovery/providers/osm-overpass.js`: Overpass QL query (`node["phone"]`), 25-business candidate generation with evidence inference. `contact_verified` boolean added to the evidence schema (binary signal: public phone on file). Standalone tested via `scripts/test-osm-overpass.mjs` (25 candidates, 21 public Phone). Not wired into the main registry pending confirmation.

### Phase 3 — Plan Limits Enforcement (complete)

Added `assertWithinLimit()` gates at every expensive work boundary across 9 sites:
- Discovery (`discover`, `owner`), webhook, research, detect-opportunities, analyze, demo-spec, jobs (type-specific), scheduler (skip-if-over). AI interpret is NOT gated (unmetered). Returns 403 with human-readable message. Lint + build pass. 43/43 self-test + 37/37 e2e pass.

### Phase 4 — Auth Gaps (complete)

Fixed 5 security issues:
1. Webhook token path now rejects suspended bound accounts → 403
2. Ingest token is server-env-scoped (client header ignored); module-load throw on misconfigured env
3. Members restricted to opportunities where `assignee_id = user.id` on pipeline/activity endpoint
4. Dead `tenantScope()` helper removed (was unused)
5. Suspended-user check moved into `requireUser()` itself (defense-in-depth)

Added 3 e2e tests: PDFMSE14 (token auth + suspension), PDFMSE15 (member activity ownership), PDFMSE16 (suspended lockout). Full suite: 38/38 pass.

### Phase 5 — Watches + WhatsApp Notifications (in progress)

**Step 1 (schema + scheduler)**: reviewed. Existing infrastructure: `discover_schedules` table, CRUD API, scheduler tick.

**Step 2 (watch creation flow — complete)**:
- `billing_plans.limit_watches` column added (MySQL DDL + `db/migrations/021_billing_plans_watches.sql`). Free=3, Pro=25, Internal=∞.
- `lib/accounts/usage.js`: added `watchLimitStatus()` + `assertWithinWatchLimit()` (counts only `enabled=1` schedules)
- `POST /api/discover/schedules`: enforces watch cap (403), rejects duplicate names (409), returns `watch_limit` in response
- Owner Mode UI: completed-run results card includes "Keep watching for opportunities like this" block with interval picker + "Watch automatically" button (posts strategy.filters)
- New e2e `PDFMS20`: proves owner strategy → watch creation, plan cap enforcement, pause frees slot, cleanup

**Step 3 (notification trigger)**: pending — scheduled for next implementation pass.

### Phase 6 — One-Tap WhatsApp Outreach Send (not started)

Planned: deep-link `wa.me` button on opportunity card, logged to `pipeline_events`. Research on WhatsApp Business API vs deep-link approach pending.

---

## 20. Known Notes

* **DB duality**: The migration files are Postgres-flavored (for the eventual Postgres target). The live runtime uses MariaDB. New schema additions (like `limit_watches`) must be applied as both MySQL DDL to the live DB and a Postgres migration file.
* **OSM Overpass**: fully built and tested but not wired into the main registry; waiting for user confirmation.
* **WhatsApp notifications**: stub for scheduled-discovery-triggered notifications is the immediate next work item (Phase 5, step 3).
* **Deep-link outreach**: Phase 6 — wa.me button implementation pending.
* **lib/db.js rewrite**: paused; would switch from mysql2 to pg once the Postgres DB is production-ready.
* **Multi-instance rate limiting**: the current in-memory rate limiter is per-process; shared state (Redis) would be needed for horizontal scaling.
