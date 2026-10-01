# OpportunityOS — Full Project Review

> One-file description of everything in this project: what it is, how it is built,
> how it works, whether it works in real life, and where it does not.

---

## 1. What this project is

**OpportunityOS** (`oppos`, version 0.1.0 in `package.json`) — a **Business
Opportunity Intelligence Platform**. It is a Next.js 16 (App Router, plain
JavaScript) + MariaDB/MySQL SaaS application, roughly 20,000 lines split across
`app/`, `components/`, `lib/`, `db/`, `scripts/`, and `test/`.

The core idea: you are a software provider (the build is Kenya-focused, KES
priced), and the platform:

1. discovers businesses from public information,
2. researches how they operate,
3. detects evidence-backed problems,
4. matches those problems to software you can actually build and sell,
5. estimates financial impact as clearly-labeled *illustrative* scenarios,
6. scores each opportunity 0–100 (HOT/HIGH/MEDIUM/LOW/REJECT),
7. drafts personalized outreach (3 WhatsApp variants per opportunity),
8. tracks it all through a 12-stage deal pipeline.

A leading product principle, repeated across the docs: **a contact is NOT an
opportunity**. Every opportunity must be backed by real evidence, a money
mechanism (a plausible HOW money is made/saved), a matching solution, business
maturity, and contactability — and if the evidence is weak the system says so
rather than inventing a problem.

---

## 2. How it is built

### 2.1 Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16.3.2, App Router | JavaScript only (no `src/`, no TypeScript), server components + client islands |
| UI | React 19.2.8, Tailwind CSS v4 | Hand-rolled components; no component library |
| Database | MySQL/MariaDB via `mysql2` | No ORM; versioned SQL migrations; all queries parameterized |
| Auth | scrypt (N=16384, r=8, p=1) + DB sessions | `$scrypt$...` hashes, httpOnly cookie `oos_session`, 14-day expiry |
| AI | Any OpenAI-compatible endpoint | Opt-in; the app runs fully without it via deterministic rule engines |
| Jobs | DB-backed background queue | Mirrors the BullMQ API so Redis/BullMQ can replace it later |
| Payments | none | `billing_plans` table only; no billing code |

### 2.2 Directory layout

```
app/               Pages + API route handlers (App Router, JS only)
  (auth) login/register, / (dashboard), discover, businesses/[id],
  opportunities/[id], pipeline, solutions, jobs, settings, owner, account,
  analytics, api/*  (~40 route handlers)
components/        Shared UI + interactive panels (DashboardCards,
                   OpportunityFeedCard, ProvenanceTags, OutreachEngine,
                   DemoConcept, PipelineKanban/List/Metrics, CapabilitiesForm,
                   OwnerMode, DiscoverClient, JobsClient, TeamManager, ...)
lib/
  db.js            mysql2 pool — the only place SQL config lives
  auth.js          scrypt hashing + session cookie management
  normalize.js     name/phone/website/social normalization for dedup
  validation.js    hand-rolled validators
  constants.js     problem types (21), signals, score weights/thresholds,
                   money mechanisms (11), pipeline transitions/probabilities
  api-helpers.js   HttpError, requireUser/requireAccount/requireRole,
                   handleRouteError, tenantScope (unused)
  audit.js         append-only audit_logs writes
  rate-limit.js    in-memory fixed-window limiter per key+IP
  accounts/        roles (owner>admin>member) + usage/plan-limit counters
  repositories/    one module per entity — the ONLY layer that writes SQL
                   (users, businesses, evidence, opportunities, financial,
                   solutions, outreach, jobs, settings, capabilities,
                   dashboard, accounts, owner, discover-schedules)
  jobs/            queue.js, worker.js, registry.js, scheduler.js, handlers/*
  services/
    discovery/     providers + one-click discovery pipeline
    research/      website/http/manual providers, polite-fetcher, coverage
    analysis/      rules-analyzer, scoring, matching, scenarios
    outreach/      3-variant Personalized Outreach Engine
    demo/          Concept Demo Generator + 8 industry templates
    providers/     ContactProvider (WhatsApp/phone rules)
  ai/              client.js (transport), provider.js (generateStructured),
                   schemas/, prompts/, agents/ (5), jobs.js (ai_jobs audit)
db/migrations/     versioned SQL (001–019; see drift note in §5)
scripts/           migrate.js, setup-db.js, mock-ai/mock-research/mock-discovery,
                   run-e2e.mjs
test/e2e.test.mjs  full end-to-end suite (~30 scenarios) run by `npm test`
```

### 2.3 Database (MariaDB, 30 tables in the live instance)

Key entities: `users`, `sessions`, `accounts`, `billing_plans`, `account_usage`,
`businesses`, `business_sources`, `business_contacts`, `business_evidence`,
`solutions`, `solution_problems`, `solution_industries`, `opportunities`,
`opportunity_evidence`, `opportunity_assumptions`, `financial_scenarios`,
`opportunity_solutions`, `outreach_messages`, `pipeline_events`, `activity_log`,
`search_queries`, `search_jobs`, `background_jobs`, `ai_jobs`, `audit_logs`,
`user_capabilities`, `owner_profiles`, `app_settings`, `discover_schedules`.

Design decisions baked into the schema:

- **Deduplication** — `normalized_name` (UNIQUE), `website_normalized`,
  `phone_normalized`, social `external_identifier`. `findBusinessByMatch()`
  checks name → website → phone → social in that order; normalization in
  `lib/normalize.js` strips legal suffixes/punctuation, phones become
  E.164-style `+<digits>`, URLs lose protocol/www/trailing slash.
- **Evidence principle** — `business_evidence.claim_type` ENUM(FACT,
  INFERENCE, HYPOTHESIS) with provenance via `source_id → business_sources`.
  `signal_key` feeds the deterministic problem-detection engine. HYPOTHESIS
  never drives detection or outreach.
- **Contact rules** — WhatsApp is its own `contact_type` and requires explicit
  publication (`source_published`/`user_confirmed` → `verified_public_whatsapp`).
  Unconfirmed phones stay `phone_only`, never promoted.
- **Scoring** — eight factor columns (evidence, problem, money, maturity,
  ability-to-pay, solution-fit, contactability, complexity) + weighted
  `opportunity_score` + `score_category` + `score_reasons` JSON. Follower/audience
  counts are only a small capped bonus inside ability-to-pay, never a dimension.
- **Tenancy** — 22 tables carry a bare `account_id` column (no FK to `accounts`);
  isolation relies entirely on repository-level `WHERE account_id = ?`. Members
  are scoped to assigned opportunities via ad-hoc checks per route.

---

## 3. How it works end-to-end

### 3.1 The opportunity lifecycle

1. **Discover** — filters are saved (`search_queries`), a `DISCOVERY` background
   job is enqueued (SHA-256 dedup prevents identical in-flight runs). Providers
   (`http`, `feed`) return candidate businesses; nothing is stored until the
   operator reviews and imports. Import dedupes and persists business → source →
   contacts → evidence with provenance.
2. **Research** — coverage-driven. The `website` provider politely fetches the
   business's own site (robots.txt respected, rate-limited) and extracts
   keyword-anchored facts. Uncovered aspects stay missing ("Research incomplete",
   never invented). `http` and `manual` providers are alternatives.
3. **Analyze** — `rules-analyzer.js` maps evidence `signal_key`s to one of 12
   hard-coded problem rules (lost_sales, manual_booking, inventory_problems, …).
   Candidates below 0.4 confidence or without a money mechanism are rejected
   (`shouldRejectCandidate`) — the engine says NO rather than inventing.
4. **Capability gate** — if a "My Capabilities" profile exists, only *enabled*
   solutions are ever recommended. An opportunity no enabled solution can serve
   is created and immediately marked `not_a_service_fit` (probability 0, no
   recommendation, reason logged).
5. **Match & Score** — `matching.js` scores every enabled solution across 4
   dimensions (problem 40%, industry 15%, technical 20%, commercial 25%);
   `scoring.js` produces the 0–100 weighted total with a per-dimension "why this
   score" reason for every factor.
6. **Estimate** — `scenarios.js` computes financial impact deterministically from
   editable low/base/high assumption triples (e.g. `monthly_enquiries ×
   conversion_improvement × average_order_value`). Scenarios are always marked
   illustrative; missing assumptions mean no scenario (never invented numbers).
7. **Outreach** — 3 variants (short/normal/professional WhatsApp) grounded in a
   real evidence observation ("I noticed …"); must be approved by a human before
   marking contacted; opt-out is terminal; a public contact is required to send.
8. **Pipeline** — 12 stages (NEW → RESEARCHING → QUALIFIED → CONTACTED → REPLIED
   → DEMO → PROPOSAL → NEGOTIATION → WON/LOST/NOT_A_FIT/NOT_A_SERVICE_FIT). Every
   transition writes `pipeline_events` + `activity_log`, auto-sets probability
   (10% new → 100% won), and recalculates `weighted_pipeline = project_value ×
   probability`. Project value (what you charge) stays separate from business
   impact (what the business gains).

### 3.2 The background job system

All long-running work is a `background_jobs` row:

- Lifecycle `queued → running → completed | failed | cancelled`.
- `claimNext()` uses `FOR UPDATE SKIP LOCKED` so multiple workers can't grab the
  same job; the in-process worker (started by `instrumentation.js`)
  processes one job at a time.
- Real progress only: handlers call `reportProgress()` at genuine milestones;
  the worker marks `completed` only when the handler returned.
- Failures retry while `attempts < max_attempts`, then become terminal.
- Cancel: queued jobs cancel instantly; running jobs get a flag their handler
  checks at safe points — interrupted runs are marked `cancelled`, never
  `completed`.
- 8 job types with handlers: DISCOVERY, RESEARCH, AI_RESEARCH,
  OPPORTUNITY_ANALYSIS, FINANCIAL_ANALYSIS, SOLUTION_MATCHING,
  OUTREACH_GENERATION, DEMO_GENERATION.
- `scheduler.js` turns due `discover_schedules` rows ("watches") into DISCOVERY
  jobs on a tick.

### 3.3 The AI engine (opt-in)

Provider-agnostic: any OpenAI-compatible `/chat/completions` endpoint works via
`AI_BASE_URL`. Five agents (BUSINESS_RESEARCH, OPPORTUNITY_ANALYST,
SOLUTION_MATCHING, OUTREACH, DEMO_SPEC), each with a strict output schema.

Safety contract, mostly enforced structurally:

- no fabricated facts/phones/revenue/followers; claims must cite evidence IDs;
- claims labeled FACT / INFERENCE / HYPOTHESIS;
- insufficient evidence ⇒ `NO_STRONG_OPPORTUNITY` (aborts scoring, no invented
  problem);
- invalid structured output ⇒ exactly one repair attempt, then marked failed;
- without `AI_API_KEY`/`AI_MODEL` nothing is faked: jobs recorded
  `skipped_no_provider` and the deterministic rule engines run instead
  (clearly labeled `analysis_provider='rules'`).

### 3.4 Business Owner Mode (`/owner`)

A fully non-technical surface: four plain questions (what you sell / where you
operate / ideal customers / goal). `lib/owner/strategy.js` derives search
filters from those words, enqueues a `DISCOVERY` run (`owner_run: 1`,
`bypassCapabilities: true` — the owner's own product, not the solution library,
defines fit), and results are shown as plain cards ("16 opportunities found") via
`lib/owner/language.js`. Progress is rendered through friendly copy ("Looking for
businesses that could be a good fit…") instead of stage names.

### 3.5 Verification layer

- `GET /api/system/self-test` — admin-only live repository test suite (~43
  assertions: normalization, dedup, contact verification, WhatsApp rules,
  scoring math, matching, scenarios, pipeline, job lifecycle, robots parser).
- `GET /api/system/ai-test` — 5 offline schema-contract tests + 5 live agent
  smoke tests (live only when a provider is set).
- `npm test` → `scripts/run-e2e.mjs` — boots mock AI / mock research / mock
  discovery servers plus `next dev`, runs `test/e2e.test.mjs` (~30 scenarios)
  covering the whole canonical flow including negative paths, webhook lead
  ingestion, scheduled discovery, and cross-tenant isolation.

---

## 4. Does it work in real life? — what was verified here

Verified against the live environment (MariaDB 10.11.19, Node v20.20.2):

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `next build` | succeeds (all routes compiled) |
| `npm run dev` | boots, worker + scheduler start (`[background-jobs] worker started`) |
| `GET /api/system/self-test` (admin) | **43/43 passed** against the live DB |
| Pages /login, /, /discover, /jobs, /pipeline | all HTTP 200 |
| Live DB content | 30 users, 13 businesses, 31 evidence rows, 12 opportunities, 9 scenarios, 8 outreach messages, 64 background jobs, 3 schedules |

So the machinery genuinely runs: detection, scoring, matching, financial
calculations, jobs, tenancy isolation, the whole test suite.

### Caveats — what does NOT work in real life yet

1. **Discovery/research are dead-ends by default.** The current `.env` (and
   `.env.example`) sets no `DISCOVERY_API_URL` or `SOCIAL_MEDIA_FEED_URL`, so
   `listProviders()` exposes only `manual` and `runSearch('manual')` returns `[]`.
   Out of the box both `/discover` and Owner Mode finish instantly with "0
   opportunities". The entire pipeline depends on an external data provider that
   nobody has defined.
2. **Plan limits are never enforced.** `assertWithinLimit()` in
   `lib/accounts/usage.js` has zero callers; free-plan caps (50 researches, 200
   opportunities, 50 AI analyses, 20 demo gens) are counted and displayed but
   nothing gates on them. Only the team-member count is enforced.
3. **AI evidence citations aren't verified.** The analyst/research schemas check
   `evidence_ids` are *present*, not that they *exist* — a hallucinated citation
   to evidence id 999999 passes validation. One ai-test assertion is a dead
   no-op (`app/api/system/ai-test/route.js:59` `!x === 'FACT'`). Outreach/demo
   "no fabrication" rules are prompt-level only.
4. **Authorization gaps.** Suspended accounts can still write via the webhook
   token path (status never checked); the shared ingest token lets any holder
   target any account; members can write `pipeline/activity` for any opportunity
   (no check); `tenantScope()` helper exists but is unused; suspended users stay
   reachable on `requireUser`-only routes.
5. **Owner/demo brittleness.** Template keyword matching mis-picks (a "barber"
   can map to the *restaurant* template before `salon`); 5 of 22 solution slugs
   map to no template; all demo/sample data is statically Kenyan (KES, M-Pesa,
   Nairobi, `+254`) regardless of the prospect's market; owner-run "found" counts
   include sub-threshold/REJECT opportunities; the AI "enhancement" only ever
   replaces template content when it is *strictly longer*, making it mostly
   cosmetic.
6. **Docs/schema drift.** `db/migrations/003_seed_demo_data.sql` (which seeded
   the `[DEMO]` "Kilimanjaro" sample quoted in the docs) is recorded as applied
   in `schema_migrations` but the file is **gone from the repo** — a fresh
   `setup-db` cannot reproduce it. The docs reference "migration 003" and seeded
   demo data that no longer exist.
7. **Test/data hygiene.** The live DB carries leftover debris: 6
   `selftest-*`/`e2e-*` businesses, 29 `*.example.test` users, and test workspaces
   ("E2E Tester's workspace", "Intruder's workspace", multiple "Live Test's
   workspace") — self-test cleanup is not perfect.
8. **Ops concerns.** In-memory rate limiter trusts `x-forwarded-for` first value
   (spoofable) and does nothing across multiple instances; no email verification,
   password reset, CSRF tokens, or session revocation; a real OpenAI API key is
   present in `.env` (gitignored, so not committed, but live in this checkout).

---

## 5. Summary verdict

A genuinely well-engineered, heavily-documented prototype with real working
evidence / scoring / job / tenant machinery that passes its own 43/43 self-test.
As a product, the mechanics work end-to-end, but it is not wired to any real
data source, does not enforce monetization limits, and has several
correctness/security holes that would matter in production. It is best described
as a thorough, tested MVP built to demonstrate the architecture and to
question its own outputs — not yet a deployed business tool.

### Quick reference: environment

```env
DATABASE_URL=mysql://root:CHANGE_ME@127.0.0.1:3307/opportunityos   # MariaDB 10.11 (Docker, host 24a911d80c53)
SESSION_SECRET=dev-secret-...                                  # HMAC signing (dev value)
APP_URL=http://localhost:3000
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-proj-...                                         # real key present in this checkout
AI_MODEL=gpt-4o-mini
AI_TIMEOUT_MS=90000
```

Run: `node scripts/setup-db.js` then `npm run dev`. Default seeded login:
`admin@example.com` / `opportunityos`. Test: `npm test` (spins up mocks + dev
server on ports 4321–4323/3100).