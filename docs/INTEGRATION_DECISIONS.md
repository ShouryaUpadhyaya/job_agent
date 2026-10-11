# Architecture & Integration Decisions (ADRs)

This document records the architectural decisions, trade-offs, adapter designs, and justifications for components built or adapted in **Job-Agent**.

---

## ADR 001: Direct Public ATS JSON Endpoints vs. Headless DOM Scraping

- **Context:** Job discovery requires ingesting opportunities from platforms like Greenhouse, Ashby, and Lever.
- **Alternatives Evaluated:**
  1. Headless browser DOM scraping using Playwright / Puppeteer.
  2. Third-party managed scraping services (e.g. Apify Actors).
  3. Direct querying of official public ATS endpoints (`boards-api.greenhouse.io`, `api.ashbyhq.com`).
- **Decision:** Query official public ATS JSON endpoints directly (`server/src/connectors/greenhouse.ts`, `server/src/connectors/ashby.ts`).
- **Rationale & Trade-offs:**
  - *Speed & Reliability:* Direct HTTP JSON calls execute in ~200ms vs 5-10s per page load in Playwright.
  - *Zero Anti-Bot Fragility:* Official public career endpoints do not throw Cloudflare Turnstile or CAPTCHA challenges to read-only API requests.
  - *Clean Structure:* Returns structured job IDs, titles, departments, and published timestamps without fragile CSS selectors.
  - *Trade-off:* Requires specifying organization tokens (e.g., `cloudflare`, `linear`), which is mitigated by supporting configurable connector lists.

---

## ADR 002: In-Process Concurrency Guard & Scheduler vs. Heavy External Queue

- **Context:** Job syncing must run periodically in the background and on-demand via REST endpoints without overlapping duplicate executions.
- **Alternatives Evaluated:**
  1. Redis + BullMQ distributed task queue.
  2. External system cron jobs (`crontab` invoking CLI commands).
  3. In-process timer (`ConnectorScheduler`) with database-backed `SyncRun` tracking and mutex lock.
- **Decision:** Adopt the in-process concurrency guard and scheduler backed by PostgreSQL `SyncRun` tracking (`server/src/jobs/syncService.ts`).
- **Rationale & Trade-offs:**
  - *Zero External Dependency:* Avoids forcing the user to run, configure, and monitor a separate Redis instance on their local Linux PC.
  - *Full Observability:* Every sync run is permanently tracked in the PostgreSQL `SyncRun` table with fetched, new, updated counts and error messages.
  - *Graceful Shutdown:* Signal traps (`SIGTERM`, `SIGINT`) cleanly release locks and stop intervals.

---

## ADR 003: Deterministic Rule-Based Matching Engine vs. Opaque Vector Similarity

- **Context:** Job listings must be classified into `APPLY`, `REVIEW`, or `SKIP` against the candidate profile.
- **Alternatives Evaluated:**
  1. Pure vector embeddings & cosine distance (pgvector / OpenAI embeddings).
  2. Pure LLM prompt per job listing (prompting Claude / GPT for every single raw job).
  3. Multi-factor deterministic rule engine with explainable criteria breakdown (`server/src/matching/engine.ts`).
- **Decision:** Implement a deterministic rule engine evaluating required vs. preferred skills, seniority disqualifiers, graduation cohort, and location suitability.
- **Rationale & Trade-offs:**
  - *Explainability:* The system must explain *why* a job scored 85 or 0 (e.g. "Seniority mismatch", "Matches graduation cohort 2027/2028"). Vector distance cannot explain constraints.
  - *Cost & Speed:* Can process 500 jobs in <10ms with zero API token costs.
  - *Deterministic Tests:* 100% reproducible and testable in continuous integration without LLM hallucinations.
  - *Negative Constraints:* Strict rule-based gates prevent recommending senior staff roles to candidates looking for internships.

---

## ADR 004: Strict Human-in-the-Loop (HITL) Gate

- **Context:** Automated systems must never execute legally binding or consequential actions without explicit human authorization.
- **Decision:** Enforce `isApproved: true` at the database and API layer (`server/src/api/applications.ts`). Any attempt to submit an application without `isApproved === true` returns an immediate `403 Forbidden` error.
- **Rationale:** Frontend safeguards alone are insufficient; the backend API strictly enforces permission boundaries.
