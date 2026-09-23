# Discovery Runs: "Sufficient Evidence" but Zero "Strong Opportunities" — Investigation

Date: 2026-09-18 · DB: `oos-postgres` → `opportunityos` (PostgreSQL, port 55432) · Read-only investigation, **no code changed**.

---

## TL;DR / Diagnosis

Answer to the a/b/c question: **(c) something else** — plus a real but secondary (b) calibration wrinkle.

1. **Root cause of 0 strong opportunities:** both recent runs used the built-in `osm_overpass` provider, which emits candidate evidence with `signal_key = NULL` (hard-coded, by design: "No fabricated signals"). When imported, no business in either run had a single signal. The deterministic problem-detection stage (`rules-analyzer`) is driven exclusively by **signals** — zero signals → zero candidate problems → **zero opportunities created** → the scoring engine **never runs** for these businesses. There is no "score below 80" — they are never scored at all.
2. **Why "3 with sufficient evidence" and "0 strong" look contradictory:** they are two different counters. `with_evidence` counts evidence *rows* with `claim_type != 'HYPOTHESIS'` and ignores `signal_key`. Opportunity creation requires *signals*. The 3 businesses genuinely have good evidence (a pubished phone on a public OSM listing, FACT @ 0.80), but none of that evidence carries a signal, so it cannot trigger detection.
3. **Even when scoring does run, nothing reaches the "strong" bar:** the best-scoring opportunity **in the entire database** is 64/100 (LOW) — 16 points under the 80 "strong" threshold. The only scored opportunities in the whole DB belong to demo fixtures (Demo Furniture Company, Fictional Nairobi/Mombasa furniture, Webhook Soap Co, Demo Hair Salon). So the 80 threshold is de facto unreachable with current single-snapshot provider evidence — that is the (b) calibration finding.

---

## 1. Reconciling "last two runs" (3/50 and 3/36)

`background_jobs` (type `DISCOVERY`) contains **16** jobs; a summary is stored in `result` at completion.

| id | created (Z) | provider | businesses_researched | with_evidence | strong | manual_follow_up | status/notes |
|----|------------|----------|----------------------|--------------|--------|------------------|--------------|
| **16** | 2026-09-17 **20:03:58** | osm_overpass | **36** | **3** | **0** | 33 | completed — the "3/36" run; Nyeri restaurants |
| 15 | 2026-09-17 20:03:47 | osm_overpass | — | — | — | — | **failed at progress 8%**, stage `discovering`, error `fetch failed` (transient OSM/Nominatim fetch error; run 16 succeeded 11 s later) |
| **14** | 2026-09-17 **19:41:59** | osm_overpass | **47** | **14** | **0** | — | completed — the previous run; Nairobi clinics |
| 9 | 2026-09-17 18:41 | osm_overpass | 47 | 14 | 0 | — | completed (prescheduled, id’d `schedule_id` 6) |
| 8 | 2026-09-17 17:41 | osm_overpass | 47 | 14 | 0 | — | completed |
| 7 | 2026-09-17 08:09:52 | (manual/http ingest) | 47 | 14 | 0 | — | completed; first import of the clinic set |

> **⚠️ The "3/50" run does not exist in this DB.** The maximum `businesses_researched` value ever recorded is **47**, and the only run with `with_evidence = 3` is run **16 (3/36)**. The prior completed run is **14/47**. If a "3/50" run exists, it was executed against a different environment/database, or the "50" was read from the provider’s returned candidate count rather than the stored summary. Stored data shows something different — flagged, not guessed.

---

## 2. Run 16 deep dive — the "3/36" (2026-09-17 20:03:58Z)

Payload: `provider: osm_overpass`, filters `{industry: restaurant, location: nyeri, businessMaturity: established, solutions: "booking system", problemCategories: [manual_booking, ... 8 more], searchQueryId 17}`.

- **36 businesses imported** (ids 152–187): Trout Tree Restaurant, Naromoru Safari Camp, Bantu Lodge, Unity Paradise Resort, White Rhino Hotel, Painted Dog, Green hills hotel, Frapa Leisure Gardens, Express Restaurant, …
- **Evidence: exactly 1 row per business.**
  - **33 × HYPOTHESIS @ confidence 0.20** — no phone/website on the OSM listing → the platform’s fallback evidence `"Listed by OpenStreetMap but no public phone, website or social contact was published — manual follow-up required."`
  - **3 × FACT @ confidence 0.80** — phone (or phone+website) actually published on the OSM listing → these are the **3 "sufficient evidence"** businesses:

| id | name | OSM source | claim_type | signal_key | confidence | evidence_text |
|----|------|-----------|-----------|-----------|------------|---------------|
| 157 | **Painted Dog** | node/4946927121 | FACT (observation) | **(none)** | 0.80 | `Painted Dog is listed on OpenStreetMap as Restaurant with phone +254799899970.` |
| 179 | **Frontiers Coffee Bar** | node/7103834585 | FACT (observation) | **(none)** | 0.80 | `Frontiers Coffee Bar is listed on OpenStreetMap as Restaurant with phone +254727 433 069.` |
| 185 | **The Nook Cafe & Bar** | node/12578607962 | FACT (observation) | **(none)** | 0.80 | `The Nook Cafe & Bar is listed on OpenStreetMap as Restaurant with phone +254 701 241 241 and website https://thenook.co.ke/.` |

- **Computed score / category:** **none** — no `opportunities` row exists for any of them (query `opportunities WHERE business_id IN (152..187)` → **0 rows**). Distance below threshold: **n/a** — they never reached scoring.
- **Notable:** none of the 3 phones were persisted as structured contacts either (`business_contacts` for 157/179/185 → **0 rows**), even though `contact_verified` was true for import purposes.

Reproduce:
```sql
SELECT e.business_id, b.name, e.claim_type, e.signal_key, e.confidence_score
FROM business_evidence e JOIN businesses b ON b.id = e.business_id
WHERE e.created_at BETWEEN '2026-09-17 20:03:30' AND '2026-09-17 20:04:10';
-- facts_with_signal for run-16 businesses: 0
-- opportunities for run-16 businesses:     0
```

---

## 3. Why detection produced nothing — exact code path

1. **Provider emits no signal.** `lib/services/discovery/providers/osm-overpass.js:284` — `evidence.push({ signal_key: null, ... })`. Documented intent at lines 15–17: *"No fabricated signals: evidence carries no signal_key"* and *"Phones are never classified as WhatsApp (always 'phone_only')"*.
2. **Import passes it through.** `lib/services/discovery/index.js:298` — `signal_key: ev.signal_key || ev.signalKey || null` → persisted as `NULL`.
3. **Signal reader requires non-empty signal_key.** `lib/repositories/evidence.js` — `signalsForBusiness()` returns rows where `signal_key IS NOT NULL` **and** `claim_type <> 'HYPOTHESIS'`. All 36 run-16 businesses → **0 signals**.
4. **Detection is signal-driven.** `lib/services/analysis/rules-analyzer.js:13`+ — `RULES` (wholesale_ordering, **manual_ordering**, lost_sales, manual_booking, inventory_problems, multi_branch_management, …) match only on signal combinations (e.g. `manual_ordering requires [['phone_whatsapp_published','active_social_commerce']], any_of_first: true`). 0 signals → `detectCandidateProblems()` returns no candidates.
5. **No opportunities → scoring never executes.** `lib/services/discovery/pipeline.js` — one opportunity per detected problem; `strong` is only counted from opportunities whose `opportunity_score >= 80`. Nothing to score.
6. **`with_evidence` counts rows, not signals.** pipeline `withEvidence = countResearchEvidenceForBusiness(...) > 0`, which counts `claim_type <> 'HYPOTHESIS'` (3 in run 16) — a different metric from what detection consumes.

**Secondary issue found (phone never stored as a contact):** `lib/services/providers/contact-provider.js:21` reads each entry as `c.value`, but the OSM provider emits contacts as `{ contact_type, contact_value, ... }` (`osm-overpass.js:308-310`). `String(c.value)` is `''` → skipped. So a published phone appears in evidence *prose* but never in `business_contacts`. Independently verifiable: 0 contact rows for businesses with "with phone +254…" evidence.

---

## 4. Same pattern on the prior run — 14/47 (Nairobi clinics)

Run 14 created **0 new businesses** (all 47 were already imported on 2026-09-17 08:09 — run 7), so `businesses_researched=47` counts existing vendors, and `with_evidence=14` counts pre-existing evidence. Of the 47 clinic businesses:

- **14** carry FACT evidence (published contact on OSM): Shachif Health Unit, Senye Clinic, Frepals Nursing Home, St Mac's Clinic, Senye Medical Clinic and Laboratory, Mary Medical clinic, St Emmaculate James, Universe Medical Clinic, Gemkam Medical Clinic, Kisembo Medical Clinic, Tumaini Medical Clinic, Uzima Chemist, MSF, Kianda Medical Center — all conf 0.80.
- **Signalled: 0.** → same result: 0 opportunities, 0 strong.

So **both** "last two runs" were blocked at exactly the same gate (detection), not at scoring.

---

## 5. Scoring calibration — could a run-16 business even reach 80? (the (b) question)

Scoring model: `lib/services/analysis/scoring.js` + `lib/constants.js`.

- Weighted 8-dimension model (sum of weights = 1.0): evidence_strength **0.20**, problem_severity **0.15**, money_potential **0.15**, solution_fit **0.15**, business_maturity **0.10**, ability_to_pay **0.10**, operational_complexity **0.10**, contactability **0.05**.
- Category thresholds (defaults; per-account override via `app_settings.score_thresholds`, `lib/repositories/settings.js`): **hot 90 · high 80 · medium 65 · low 50**. **Strong = opportunity_score ≥ 80** (the `high` default).
- Evidence factor: `evidenceStrengthFactor = round(min(1, n/4)·60 + avgConf·100·0.4)`.

**Hypothetical evidence_strength for a run-16 business** (1 FACT row @ 0.80): `0.25·60 + 0.80·100·0.4 = 15 + 32 = 47`. Maxing evidence would need 4 rows @ conf 1.0 (= 100).

**Best score ever recorded — 64/100 (LOW):** Demo Furniture Company (`manual_ordering`, `analysis_provider='llm'`):

| dimension (weight) | value | weighted pts |
|--------------------|------:|-------------:|
| evidence_strength (0.20) | 77 | 15.4 |
| problem_severity (0.15) | 55 | 8.25 |
| money_potential (0.15) | 100 | 15.0 |
| solution_fit (0.15) | 82 | 12.3 |
| business_maturity (0.10) | 17 | 1.7 |
| ability_to_pay (0.10) | 0 | 0.0 |
| operational_complexity (0.10) | 85 | 8.5 |
| contactability (0.05) | 58 | 2.9 |
| **total** | | **64.05 → 64** |

Hardest drags: **ability_to_pay = 0** (no pay-capacity signal in the dataset), **business_maturity = 17** (single maturity signal), **contactability = 58**.

**Global corpus context:**
- 206 evidence rows total: 118 HYPOTHESIS, 60 FACT, 24 INFERENCE, 4 listing_detail; **138 (67%) have a blank `signal_key`**.
- 40 businesses have non-HYPOTHESIS ("research") evidence; **20** have signalled evidence; **20** have opportunities.
- **All 20 signalled / 20 opportunity businesses are demo fixtures** (Demo Furniture Company, Fictional Nairobi Furniture Works, Fictional Mombasa Woodcraft, Webhook Soap Co, Demo Hair Salon — ids 62,63,64,65,72,73,74,75,82,83,87,88,92,93,94,95,68,78,86,98). The signalled evidence / opportunities were seeded by fixtures/webhook ingest, **not** by a discovery provider.
- Real discovery businesses (OSM/google/http): **0 signalled, 0 opportunities, 0 scores ever.**

**Conclusion:** with the current evidence taxonomy, single-snapshot discovery data can’t reach strong. The 80 bar is only achievable with multi-signal, time-series evidence (the webhook/live-ingest path). This is a real calibration/taxonomy issue (b) — but it is **not** what blocked the last two runs (c blocked them first).

---

## 6. The failed job `selftest-1789633772768`

`search_jobs` row: id **12**, query_name `selftest-1789633772768`, **status = failed, progress = 5**, `error_message = 'Error: test failure'`, created 2026-09-17 08:29:33, completed 15 ms later. Paired with a completed job (id 11, progress 100) with the same query_name/timestamp.

**This is an expected self-test artifact, not a real failure:**
- `app/api/system/self-test/route.js` creates jobs named `selftest-${Date.now()}` and runs assertion sub-tests, including a deliberate `failJob(account, fid, new Error('test failure'))` case whose assertion checks that `error_message` contains `"test failure"`.
- `progress = 5` is the baseline set by `startJob()` (`lib/repositories/jobs.js:70-77` → `setProgress(jobId, 5)`); `failJob()` (`jobs.js:108-114`) updates only `status`/`error_message`/`completed_at`, so a failed job keeps progress **5**.
- **Every** self-test run produces this completed(100) + failed(5) pair — observed stamps: 08:29:33, 08:06:54, 07:48:26, 07:40:35, 07:39:19, 07:32:55.

---

## 7. Recommendations (no changes made)

1. **Fix the pipeline so discovery data can actually produce opportunities.** Choose one of:
   - (a) At the provider boundary, map *genuinely published* contact facts to real, supportable signals (e.g. a phone-published listing → the `phone_whatsapp_published` family) with calibrated confidence, so `manual_ordering`/related rules can fire; or
   - (b) make `detectCandidateProblems` consume structural data (e.g. `business_contacts` rows / verified contact flags) in addition to evidence `signal_key`s, so a published phone isn’t invisible to detection.
   - Alignment needed with the provider’s explicit "never fabricate signals / never imply WhatsApp" safety stance (osm-overpass.js:15-17) — the mapping must stay honest (e.g. phone_only must not be sold as WhatsApp).
2. **Fix the contact-shape mismatch** so published phones persist structurally: `contact-provider.js` reads `c.value` while OSM emits `contact_value` (`osm-overpass.js:308`). Phone-only numbers are silently dropped today.
3. **Recalibrate or enrich** so "strong" is achievable: either lower/decouple the strong bar relative to single-snapshot evidence, raise evidence-base expectations (re-observation/webhook re-scrapes before claiming "sufficient"), or re-weight evidence_strength vs confidence.
4. **Verify the "3/50" data** the user referenced — not present in this DB (max 47; the 3-evidence run is 3/36). If that run exists elsewhere, its timestamp would let us locate it.

---

### Reproduce scripts

```bash
docker exec oos-postgres psql -U root -d opportunityos -P pager=off \
  -c "SELECT id, created_at, status, progress, result FROM background_jobs WHERE type='DISCOVERY' ORDER BY id;"
docker exec oos-postgres psql -U root -d opportunityos -P pager=off \
  -c "SELECT q.query_name, j.status, j.progress, j.error_message FROM search_jobs j JOIN search_queries q ON q.id=j.search_query_id WHERE q.query_name LIKE 'selftest-%' ORDER BY j.created_at DESC LIMIT 20;"
```