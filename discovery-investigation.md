# Discovery runs: why "sufficient evidence" businesses never become strong opportunities

**Date:** 2026-09-19 — **Scope:** read-only investigation, no code changed.
DB: `opportunityos` (PostgreSQL, `oos-postgres` container, 127.0.0.1:55432).

---

## 0. What the UI numbers actually mean

| UI label | Source | Definition |
|---|---|---|
| Businesses researched | `businesses_researched` | Businesses **newly imported** in the run. |
| Had sufficient evidence | `with_evidence` | Businesses with >= 1 evidence row where `claim_type != 'HYPOTHESIS'` (`countResearchEvidenceForBusiness`, `lib/repositories/evidence.js:62`). **Contact-availability proxy, NOT detectability.** |
| Strong opportunities | `strong_opportunities` | Opportunities with `opportunity_score >= 80` (HIGH default; `thresholds.high ?? 80`, `lib/services/discovery/pipeline.js:135-138`). |

"HAD SUFFICIENT EVIDENCE" IS MISLEADING: a single `FACT` row ("listed on OSM with a phone") qualifies a business as "with evidence", yet the detection engine can use nothing about it (see 1.4).

---

## 1. The three businesses from the most recent run (your "3/36")

### 1.1 The run — `background_jobs.id = 16`

| Field | Value |
|---|---|
| created_at | 2026-09-17 **20:03:58** |
| provider | `osm_overpass` (OpenStreetMap Overpass; default max results = **50**) |
| filters | industry=`restaurant`, location=`nyeri`, businessMaturity=`established`, solutions=`booking system` |
| result | `businesses_researched: 36, with_evidence: 3, strong_opportunities: 0, manual_follow_up: 33, opportunity_ids: []` |

Imported businesses: `businesses.id` 152-187 (account 1, `data_origin=provider`).

### 1.2 The three "with evidence" businesses (only ones with a non-HYPOTHESIS row, `contact_verified=t`)

| business_id | Name | OSM source |
|---|---|---|
| 157 | Painted Dog | https://www.openstreetmap.org/node/4946927121 |
| 179 | Frontiers Coffee Bar | https://www.openstreetmap.org/node/7103834585 |
| 185 | The Nook Cafe & Bar | https://www.openstreetmap.org/node/12578607962 |

### 1.3 Their complete evidence (exactly ONE row each)

| evidence_id | business | claim_type | evidence_type | signal_key | confidence | text |
|---|---|---|---|---|---|---|
| 200 | 157 Painted Dog | FACT | observation | **(empty)** | 0.80 | "Painted Dog is listed on OpenStreetMap as Restaurant with phone +254799899970." |
| 222 | 179 Frontiers Coffee Bar | FACT | observation | **(empty)** | 0.80 | "Frontiers Coffee Bar is listed on OpenStreetMap as Restaurant with phone +254727…" |
| 228 | 185 The Nook Cafe & Bar | FACT | observation | **(empty)** | 0.80 | "The Nook Cafe & Bar is listed on OpenStreetMap as Restaurant with phone +254701…" |

The other 33 businesses each have one `HYPOTHESIS` claim (confidence 0.20, excerpt "No public contact details found") — the inventory/manual-follow-up marker, never counted for detection.

### 1.4 Their computed score / category: NONE

`opportunity_ids: []` — `detectOpportunities` created **zero** opportunities for any of the 36 businesses, so `analyzeOpportunity`/`computeScore` (scoring) **never ran**. No `opportunity_score`, no `score_category`, no `score_reasons` exist in `opportunities` for 157/179/185.

Why no opportunity was even proposed — the chain:

1. Detection is a deterministic rule engine keyed on **`signal_key`** values (`RULES`, `lib/services/analysis/rules-analyzer.js:13`, `detectCandidateProblems:145`).
2. `signalsForBusiness` (`lib/repositories/evidence.js:107`) only returns evidence rows **with a non-empty `signal_key`**. All 36 businesses have none (OSM provider emits `signal_key: null` — see comment at `lib/services/discovery/providers/osm-overpass.js:16-17`: *"No fabricated signals: evidence carries no signal_key"*).
3. `signals = {}` -> no RULE can match -> `detectCandidateProblems` returns `[]` -> no opportunity.
4. Opportunities are the **only** entry point into scoring (`analyzeOpportunity`, `lib/services/analysis/index.js`). No opportunity = no score = 0 "strong".

So the answer to "how far below the 80 threshold are they?" is: they have **no score at all**. It is not a threshold-margin problem.

### 1.5 Bonus bug found: phone contacts silently dropped

The 3 candidates DID carry phone contacts from OSM (`{ contact_type: 'phone', contact_value, verification_status: 'phone_only' }`, `osm-overpass.js:308-310`), but `business_contacts` has **0 rows** for them. Cause: the OSM provider uses the field key **`contact_value`**, while `manualContactProvider.extract` reads **`c.value`** (`lib/services/providers/contact-provider.js:21`). `undefined` -> `if (!value) continue;` -> contact discarded.
Consequence: `contactabilityFactor` is 0 for these reachable businesses, and the phone only lives inside the evidence text. This is a real defect independent of the main finding.

### 1.6 Why they could never have been "strong" even in the best case

- Scoring weights (`lib/constants.js:59`): evidence 0.20, problem 0.15, money 0.15, solution_fit 0.15, maturity 0.10, ability_to_pay 0.10, complexity 0.10, contactability 0.05. Thresholds `{hot:90, high:80, medium:65, low:50}` (`lib/constants.js:86`).
- `evidenceStrengthFactor` for a single 0.80-confidence row (`scoring.js:210`): `round(min(1, 1/4)*60 + 0.8*100*0.4) = round(15 + 32) = **47**`.
- maturity 0 (no signals), ability_to_pay <= 30, contactability 0 (dropped contacts), solution_fit 0 without a matched solution.
- Generous hypothetical total (sev 70, money 60, fit 70, complexity 60): 9.4+10.5+9+10.5+0+3+6+0 = **~48 -> REJECT** (<50). Even ideal assumptions miss HIGH (80) by ~30+ points.

---

## 2. The failed `selftest-1789633772768` job

| Field | Value |
|---|---|
| `search_jobs.id` | 12 (query `selftest-1789633772768`, `search_queries.id` 11) |
| account | 1 |
| status | **failed** |
| progress | 5 |
| error_message | exactly `Error: test failure` |
| created_at | 2026-09-17 08:29:33 |
| sibling `search_jobs.id` 11 | **completed** at 100% (12s earlier) |

**Origin — it is a deliberate self-test artifact, NOT a real pipeline failure.**
`app/api/system/self-test/route.js` runs a test named **"failJob persists error message"** (`route.js:595-609`): it creates a `selftest-<timestamp>` query (stamp at `route.js:57`), `startJob`, then intentionally calls `jobsRepo.failJob(ACCOUNT, fid, new Error('test failure'))` and asserts the error_message was persisted. `failJob` (`lib/repositories/jobs.js:108`) sets only status/error_message/completed_at and never resets `progress`, which is why it stays at 5.

The completed sibling job (id 11) comes from the "job lifecycle + duplicate protection" test. **Safe to ignore.**

Note: separate from this, background DISCOVERY jobs 10 and 15 (19:39 and 20:03) DID fail for real at "discovering" stage 8% with `fetch failed` — transient failures calling the provider API. Not the selftest, and unrelated to the evidence question.

---

## 3. Diagnosis (your question 3)

**Answer: (c) — it is a structural gap, not thresholds and not merely evidence depth.**

- **Not (b) threshold miscalibration**: there is no score to calibrate; tuning thresholds changes nothing while zero opportunities are created.
- **Not purely (a) thin evidence**: deeper research would add more claims, but they are useless for detection unless mapped to `signal_key`.
- **Actual cause**: what the provider returns (a directory listing + a phone FACT with `signal_key: null`) does not match what the rule engine needs (`signal_key`-tagged evidence). Therefore `with_evidence` (3) is a cosmetic metric; the effective number of *detectable* businesses in the run is **0**.

Supporting evidence for this conclusion:
- `signalsForBusiness`/`evidenceBySignal` filter on non-empty `signal_key` (`evidence.js:107,128`).
- Detection matches only signal keys bearing rules (`rules-analyzer.js:145`); keys used are e.g. `phone_whatsapp_published`, `no_online_ordering`, `multiple_channels`, `manual_ordering` — none are produced by OSM.
- `ensureResearched` (`pipeline.js:154`) only **counts** existing evidence; it performs no research. So provider candidates never get a research pass to derive signals.
- `appendCandidateEvidence` passes the provider's `signal_key` through unchanged (`lib/services/discovery/index.js`, OSM sends `null`).
- The OSM provider covers only `industry` + `location` (category tags); it genuinely cannot emit diagnostic signals like ordering/booking/operations.

### The "3/50" vs "3/36" discrepancy

No stored run has `businesses_researched = 50`. The complete account-1 discovery ledger is:

| job | when | business | location | with_evidence | researched | opportunities | strong |
|---|---|---|---|---|---|---|---|
| 7 | 08:09 | clinic | nairobi | 14 | 47 | 0 | 0 |
| 8 | 17:41 | clinic | nairobi | 14 | 47 | 0 | 0 |
| 9 | 18:41 | clinic | nairobi | 14 | 47 | 0 | 0 |
| 14 | 19:41 | clinic | nairobi | 14 | 47 | 0 | 0 |
| 15 | 20:03 | clinic | nairobi | failed at 8% (`fetch failed`) | | | |
| 16 | 20:03 | restaurant | nyeri | **3** | **36** | 0 | 0 |

"50" most likely comes from the OSM provider cap (`OSM_OVERPASS_MAX_RESULTS`, default 50) or conflation; the data only supports 3/36. Every *successful* run produced 0 opportunities — not just run 16 — so this is a systematic issue, not a one-off.

---

## 4. Suggested fix directions (for your decision — NOT implemented)

1. **Provider → signals**: have OSM (or a small classifier) derive `signal_key`-tagged evidence from listing fields it CAN see legally (phone present, website present, category, opening hours, chain brand) — e.g. map `website_exists` -> `online_presence`, `has_phone` -> contact signals. This alone would let the rule engine start detecting.
2. **Structural research pass**: replace/provider research that fetches the website and extracts ordering/booking/operations signals (works for the ~3 reachable businesses).
3. Both: provider supplies raw contact/listing signals; pipeline enriches via research.

Only after signal-bearing evidence exists does tuning `evidenceStrengthFactor`/thresholds become meaningful.