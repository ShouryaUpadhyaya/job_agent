# Implementation Status

What is implemented today, by area. The Phase 0–8 sections describe the improvement pass that
removed fabricated data and ToS-violating code; the older Sprint/Milestone tables below are kept
as history, and items they describe that no longer exist are marked **superseded**.

Run `npm run test:server`, `npm run test:web`, `npm run build:server`, `npm run build:web` and
`npm run lint -w web` for the current test and build status (counts change often, so they are not
recorded here).

---

## Phase 0 — Foundation (DONE)

| ID | Description | Component | Notes |
|---|---|---|---|
| P0-1 | Isolated test database | `server/vitest.test-db.mts`, `server/vitest.global-setup.mts` | Derives `<db>_test` from `DATABASE_URL` (or `TEST_DATABASE_URL`), creates it and runs `prisma db push`; refuses database names without `test`. |
| P0-2 | Schema additions | `server/prisma/schema.prisma` | Listing freshness/liveness/`userStatus`/`companyKey`, `Resume`, contact source/persona/URLs, application `source`/`lastEmailAt`, `EmailEvent.isDemo`, `WellfoundRun`. |
| P0-3 | Shared helpers | `server/src/lib/*` | `companyKey`, `canTransition` (forward-only automated stage changes), IST time, active profile, single Gemini client (key in header, model fallback, timeouts). |
| P0-4 | Web foundations | `web/src/lib/api.ts`, `Dashboard.tsx` | Typed fetch wrapper; tabs mirrored in `?tab=`. |

## Phase 1 — Wellfound AutoApply (DONE)

| ID | Description | Component | Notes |
|---|---|---|---|
| P1-1 | Repo-owned runner | `scripts/wellfound/runner.js`, `build-wellfound-paste.js` | Upstream submodule kept unmodified; `DRY_RUN` written explicitly on every build. |
| P1-2 | Host agent + preflight | `scripts/wellfound/agent.js`, `preflight.js`, `server/src/wellfound/runService.ts` | Local or agent executor; token-protected agent; actionable preflight checklist. |
| P1-3 | Runs, logs, diagnostics | `WellfoundRun`, `/api/wellfound/runs/*` | Append-only log per run, SSE stream with polling fallback, screenshots/HTML/JSON/trace per failure, HTML served as sandboxed attachment. |
| P1-4 | Correct daily count and cap | `scripts/wellfound/lib.js` | ISO timestamps in the CSV, IST "today", `min(batch, cap − today)`. |
| P1-5 | Live confirmation | `RunPanel.tsx`, `runService.ts` | Type `APPLY` in the UI; API requires `confirmLive: true`. |
| P1-6 | Profile as source of truth | `server/src/wellfound/config.ts` | Runner config generated from the DB profile and rules; Gemini key never sent to the browser. |
| P1-7 | Forward-only CSV import | `connectors/wellfoundAutoApplyService.ts` | Idempotent, uses `canTransition`, creates no contacts. |

## Phase 2 — Job Discovery (DONE)

| ID | Description | Component | Notes |
|---|---|---|---|
| P2-1 | Fake and ToS-violating code removed | `connectors/` | Wellfound mock jobs, LinkedIn guest scraper and server-side LinkedIn fetch deleted; `POST /jobs/scrape/linkedin` returns 410. LinkedIn/Wellfound imports take pasted details only. |
| P2-2 | New connectors and curated defaults | `connectors/registry.ts` | SmartRecruiters, Workable, Remotive, Remote OK; RSS/JSON wired; defaults verified against live APIs (`docs/JOB_SOURCES.md`). |
| P2-3 | Job-alert emails as a source | `discovery/jobAlerts.ts` | LinkedIn, Naukri, Internshala, Wellfound, Instahyre alerts → `source = email:<site>`. |
| P2-4 | Search links and X feeds | `discovery/searchLinks.ts`, `xSources.json` | Prefilled searches the user opens; researched X accounts (`docs/X_SOURCES.md`). |
| P2-5 | Matching rewrite | `matching/` | Word-boundary skills with aliases, profile-driven eligibility, seniority, freshness, score capped 0–100, per-resume best match. |
| P2-6 | Liveness | `jobs/liveness.ts` | Closed after 2 missed feed syncs; stale listings rechecked via ATS APIs after each scheduled sync; LinkedIn/Naukri never fetched. |
| P2-7 | Jobs API and Discovery UI | `api/jobs.ts`, `JobDiscovery.tsx`, `discovery/` | Filters, sorts, facets, pagination, save/dismiss, freshness badges, sources drawer. Email placeholder listings (`source = 'email'`) hidden. |
| P2-8 | Cleanup script | `scripts/cleanupFakeJobs.ts` | Dry run unless `--apply`. |

## Phase 3 — Profile, multiple resumes, system overview (DONE)

| ID | Description | Component | Status | Tests | Notes |
|---|---|---|---|---|---|
| **P3-1** | Multiple resumes | `server/src/api/resumes.ts`, `server/src/resumes/service.ts` | **DONE** | `resumesApi.test.ts` | `GET/POST/PATCH/DELETE /api/resumes`, `POST /api/resumes/:id/default`, `GET /api/resumes/rescore-status`. Create from a PDF (`resume`/`file` multipart field) or pasted `content`. Skills come from the `matching/skills.ts` vocabulary and can be edited, including removing them. There is always exactly one default resume. You can't delete the last resume, and deleting the default promotes the oldest remaining one. Each resume shows "best for N active jobs", taken from `JobListing.bestResumeId`. `CandidateProfile.rawResume` mirrors the default resume. |
| **P3-2** | Rescore after edits | `server/src/resumes/rescore.ts` | **DONE** | API tests | Profile and resume changes call `rescoreAllJobs()` and wait up to `RESCORE_WAIT_MS` (5 s). Larger databases finish in the background, and requests made during a run queue one more pass. |
| **P3-3** | Profile API fixes | `server/src/api/profiles.ts` | **DONE** | `profiles.test.ts`, `profilesResumeApi.test.ts` | Saves are partial: only the fields sent are changed, so saving no longer wipes `rawResume`. `applicationAnswers` is shallow-merged, with `null` deleting a key, so `wellfoundRules` survives. `PATCH /api/profiles` is added. `GET` uses `ensureActiveProfile()` instead of the hard-coded profile. The legacy `upload-resume` now adds a Resume, fills only empty profile fields and stores versioned Documents. |
| **P3-4** | Resume parser | `server/src/resumes/parser.ts` | **DONE** | `resumeParser.test.ts` | Skills are matched with word boundaries, so "Google" no longer counts as Go. Also parses: the name (including all-caps names), phone, GitHub/LinkedIn/X/portfolio links, and the education institution, degree, GPA and graduation year (the end of a range, e.g. "Aug. 2024 – May 2028" gives 2028). Experience and projects are parsed into structured entries. |
| **P3-5** | System overview | `server/src/api/overview.ts`, `web/src/components/SystemOverview.tsx` | **DONE** | `overviewApi.test.ts`, `SystemOverview.test.tsx` | `GET /api/overview` returns: active jobs by source and freshness, internships, APPLY/REVIEW counts, and applications by stage. It also returns new applications this week and the response rate (applications with an interview, assessment, rejection or offer email ÷ applied). Then contacts by status and VIT alumni, the last sync and 24 h failures per source, Gmail status, the last Wellfound run and the resume count. |
| **P3-6** | Profile page | `web/src/components/ProfileManager.tsx`, `web/src/components/profile/` | **DONE** | `ProfileManager.test.tsx` | The page shows the overview first, then editable sections: contact, links, preferences, skills, education, experience/projects and application answers (shared keys with the Wellfound config). The resumes manager comes last: upload or paste, edit, set default, and delete with inline confirmation. |
| **P3-7** | Target Companies tab removed | `web/src/components/Dashboard.tsx`, `web/src/components/discovery/SourcesDrawer.tsx` | **DONE** | `Dashboard.test.tsx`, `JobDiscovery.test.tsx` | "Target Companies" / "Job Sources" was just a label on the sources manager. Source management is now the **Manage sources** drawer in Job Discovery. Old `?tab=SOURCES` links (and `?sources=1`) open Discovery with that drawer open. |
| **P3-8** | Copilot grounding | `server/src/api/copilot.ts` | **DONE** | `copilot.test.ts` | Copilot uses the active profile (`ensureActiveProfile`). Cover letters and answers are grounded in the job's best resume, falling back to the default resume. |
| **P3-9** | Legacy resume migration | `server/src/scripts/migrateResumes.ts` | **DONE** | `migrateResumes.test.ts` | `npx tsx src/scripts/migrateResumes.ts` does a dry run. `--apply` creates a default "General" resume from `rawResume`, or else from the latest RESUME document. |

---

## Phase 4 — Application Pipeline (DONE)

| ID | Description | Component | Notes |
|---|---|---|---|
| P4-1 | Stage fixes and duplicate guard | `api/applications.ts` | Re-import no longer resets stage; `POST` returns the existing application; `PATCH` validates the stage and syncs `status`; ARCHIVED stage. |
| P4-2 | Server-side sorts and filters | `applications/service.ts` | Sorts: fit, match, alumni, recent, applied, company. Filters: stage, source, has alumni, search. |
| P4-3 | Fit score | `applications/fit.ts` | Match 45, alumni 20, contacts 10, freshness 10, stage 10, email 5; breakdown in a tooltip. |
| P4-4 | UI | `ApplicationsPipeline.tsx`, `pipeline/` | List/board toggle, optimistic edits, people strip with quick add, find-people links and referral drafts. |
| P4-5 | Audit trail | `applications/audit.ts` | Manual, Gmail and Wellfound stage changes and creations recorded in one shape; read by the briefing. |

## Phase 5 — Networking CRM (DONE)

| ID | Description | Component | Notes |
|---|---|---|---|
| P5-1 | Fabricated contacts removed | `scripts/cleanupFakeContacts.ts`, `networking/` | Generators deleted; `POST /networking/generate-targets` now only returns search links. |
| P5-2 | People discovery | `networking/peopleLinks.ts`, `github.ts` | LinkedIn/Google/X search links the user opens; public GitHub org members via the API. |
| P5-3 | Quick add, dedupe, merge | `networking/contacts.ts`, `parse.ts` | Headline parsing, URL validation (`/in/`, `x.com/<handle>`). |
| P5-4 | Priority score | `networking/priority.ts` | Alumni, persona, pipeline stage, recent postings, no-reply penalty; breakdown shown. |
| P5-5 | Message drafts | `networking/messages.ts` | Connection note ≤ 300 chars, referral ask ≤ 120 words, follow-up, thank-you; Gemini or profile-based templates; rules from `docs/NETWORKING_PLAYBOOK.md`. |
| P5-6 | UI | `NetworkingCrm.tsx`, `networking/` | Filters (company, persona, alumni, 11 statuses, source, follow-up due), sorts, debounced search, drafts with copy / mark sent. |

## Phase 6 — Gmail (DONE)

| ID | Description | Component | Notes |
|---|---|---|---|
| P6-1 | OAuth and tokens | `email/service.ts`, `oauthState.ts`, `config.ts` | `GMAIL_*` and legacy `GOOGLE_*` names, single-use `state`, refreshed tokens persisted, refresh token kept on re-consent, revoke on disconnect, `EXPIRED` status surfaced. |
| P6-2 | Incremental, idempotent sync | `email/service.ts`, `query.ts`, `mime.ts` | Curated query, pagination, oldest first, skip stored messages before side effects, body decoding; one sync at a time. |
| P6-3 | Classifier | `email/classifier.ts`, `refine.ts` | 12 classes, ATS-aware company extraction, job-alert-first rules, deadlines, importance; optional Gemini for low confidence. |
| P6-4 | Effects | `email/effects.ts` | Forward-only stage changes at confidence ≥ 0.8; confirmations create/advance applications; LinkedIn accepts update contacts; recruiter replies become contacts; alerts → Discovery. |
| P6-5 | Summary and UI | `email/summary.ts`, `GmailSync.tsx`, `gmail/` | Needs-action items, email-driven moves, counts, filters for every class, connection health. |
| P6-6 | Demo mode | `email/demo.ts`, `scripts/cleanupDemoEmails.ts` | Explicit, `isDemo`-flagged, excluded everywhere; never inserted on sync failure. |
| P6-7 | Scheduled sync | `scheduler/cron.ts` | Runs each scheduler tick when connected; `GMAIL_AUTO_SYNC=false` disables it. |

## Phase 7 — Daily Briefing (DONE)

| ID | Description | Component | Notes |
|---|---|---|---|
| P7-1 | IST-day briefing with catch-up | `briefing/summary.ts`, `scheduler/cron.ts` | One row per IST day; generated at/after 20:00 IST, checked every 5 minutes and on start, independent of the job sync. |
| P7-2 | Content | `briefing/build.ts`, `inShort.ts`, `render.ts` | In short, today's actions, people to message, new matches, pipeline movement, Wellfound runs, stale applications (14+ days), week-over-week stats. |
| P7-3 | UI | `DailyBriefing.tsx`, `briefing/` | Section cards with deep links to tabs, live view, regenerate, IST-dated history. |

## Phase 8 — Docs (DONE)

README, CLAUDE.md, ARCHITECTURE.md, SECURITY.md and this file rewritten for the current code.

## Known gaps

- `ApplicationCopilot` ("Apply with copilot" in a job's detail view) is a local cover-letter
  editor. Its "Approve and Submit" button only changes local UI state; it does not call the API
  and nothing is submitted.
- Gmail and Wellfound tokens/session are stored unencrypted (database row / Chrome profile
  directory); see `SECURITY.md`.

---

## History (earlier sprints)

## Sprint 4 — LinkedIn Referral CRM, Gmail OAuth Engine, Wellfound/LinkedIn Ingestion & 8:00 PM IST Daily Briefing (VERIFIED & COMPLETED)

| ID | Description | Component | Status | Tests | Verification Summary |
|---|---|---|---|---|---|
| **S4-1** | Gmail OAuth & Multi-Class Email Classifier | `server/src/email/` | **DONE** | 9 integration tests | Google OAuth 2.0 flow via `googleapis`, `ConnectedAccount` persistence, comprehensive 12-class classifier (`INTERVIEW_INVITATION`, `ASSESSMENT`, `REJECTION`, `OFFER`, `LINKEDIN_CONNECTION_ACCEPTED`, `APPLICATION_CONFIRMATION`, etc.) with sender/company/role heuristics. |
| **S4-2** | LinkedIn Acceptance & Pipeline Auto-Correlator | `server/src/email/service.ts` | **DONE** | Verified in tests | Correlates interview emails to `JobApplication` (advancing stage to `INTERVIEWING`/`OFFERED`), detects LinkedIn connection acceptance emails, updates contact to `ACCEPTED`, and auto-generates draft referral follow-up. |
| **S4-3** | Networking Referral CRM & Persona Discovery | `server/src/networking/crm.ts` | **SUPERSEDED** (generated personas removed, Phase 5) | 7 unit + API tests | `NetworkingContact` & `NetworkingMessage` models, lifecycle stages (`RESEARCHED` → `REQUEST_SENT` → `ACCEPTED` → `REFERRAL_REQUESTED` → `REFERRED`), ranked persona research prioritizing VIT Vellore alumni (98% fit), software engineers, and campus recruiters. |
| **S4-4** | Strict 300-Char Connection Note & Referral Generator | `server/src/networking/messages.ts` | **SUPERSEDED** (rewritten in Phase 5; no hard-coded profile text) | Unit tests | Strict LinkedIn <300 character constraint validation, customized outreach angles for VIT alumni, recruiters, and engineering managers, personalized referral asks referencing the candidate's skills. |
| **S4-5** | Wellfound & LinkedIn Job Ingestion & Checklist | `server/src/connectors/` | **SUPERSEDED** (paste-only imports, Phase 2) | 5 integration tests | `normalizeWellfoundJob` for startup ecosystem jobs, `normalizeLinkedInJob` with numeric ID extraction, pre-application checklist generator identifying Easy Apply vs Direct Apply, and browser handoff routes (`POST /api/jobs/import/wellfound`, `POST /api/jobs/import/linkedin`, `GET /api/jobs/:id/checklist`). |
| **S4-6** | Daily Job-Search Briefing & 8:00 PM IST Scheduler | `server/src/briefing/` & `cron.ts` | **DONE** | 3 integration tests | Daily executive digest aggregating urgent interviews, pending assessments, accepted connections, and top 3 recommended roles. Persisted in `DailyJobSearchSummary`. Scheduled at 8:00 PM IST (14:30 UTC). Endpoints: `/api/briefing/today`, `/api/briefing/generate`, `/api/briefing/history`. |
| **S4-7** | Networking CRM Cockpit UI | `web/src/components/NetworkingCrm.tsx` | **SUPERSEDED** (Auto-Discover leads removed, Phase 5) | 3 component tests | Contacts table with stage badges, VIT alumni indicators, Auto-Discover Target Leads modal, copyable connection note modal (<300 chars), and referral follow-up generator. |
| **S4-8** | Gmail Mailbox Sync & Simulator UI | `web/src/components/GmailSync.tsx` | **SUPERSEDED** (simulator replaced by labelled demo tools, Phase 6) | 1 component test | Google account connection card, "Sync Inbox Now" action, interactive live email simulator for interviewer invitations and connection acceptances, classified event stream. |
| **S4-9** | Daily Briefing Executive Cockpit UI | `web/src/components/DailyBriefing.tsx` | **DONE** | 1 component test | Executive overview cards, urgent "Needs Attention" alert highlight, formatted Markdown briefing, "Refresh Briefing Now" trigger, and historical briefing selector. |
| **S4-10** | Unified 7-Tab Dashboard & Job Import Modal | `web/src/components/Dashboard.tsx` | **DONE** | 6 component tests | Top navigation expanded to 7 tabs (🎯 Job Discovery, 📋 Pipeline, 🤝 Networking CRM, 📬 Gmail Sync, 📰 Daily Briefing, 🏢 Target Companies, 👤 Profile & Resume; the Target Companies tab was later removed — see P3-7) + inline "+ Import Job" modal for Wellfound and LinkedIn URLs. |

---

## Sprint 3 — Resume Parser, ATS Tailoring, Multi-Source Manager & Pipeline (VERIFIED & COMPLETED)

| ID | Description | Component | Status | Tests | Verification Summary |
|---|---|---|---|---|---|
| **S3-1** | Lever ATS Connector | `server/src/connectors/lever.ts` | **DONE** | 3 unit + live | Lever public posting JSON API. Live verified: Spotify (85 jobs), idempotent re-sync verified (85 updated, 0 duplicates). |
| **S3-2** | Dynamic Sources Management | `server/src/api/sources.ts` | **DONE** | 5 API tests | `JobSourceConfig` table in Prisma, `/api/sources` CRUD, per-source sync endpoint. Verified adding Figma (150 jobs synced). |
| **S3-3** | Open-source Resume Ingestion & Parser | `server/src/resumes/parser.ts` | **DONE** | 4 unit + API tests | Text extraction via `pdf-parse`, taxonomy matching across 40+ engineering skills, education, and graduation year (2028). Automatic database job rescoring. |
| **S3-4** | ATS Resume & Cover Letter Tailoring Engine | `server/src/resumes/tailor.ts` | **DONE** | 2 unit + API tests | Direct skill matches vs missing keywords, grounded impact bullets, personalized cover letter generation saved to versioned `Document`. |
| **S3-5** | Applications Pipeline & Stage Tracking | `server/src/api/applications.ts` | **DONE** | 3 integration tests | Stages (`BOOKMARKED`, `APPLYING`, `APPLIED`, `INTERVIEWING`, `OFFERED`, `REJECTED`), audit logs, notes, and strict human approval gate. |
| **S3-6** | Applications Pipeline UI | `web/src/components/ApplicationsPipeline.tsx` | **DONE** | 3 component tests | Full kanban stage cards, stage selector dropdown, notes editor modal, remove action. |
| **S3-7** | Sources UI (formerly "Target Companies"; now the Discovery drawer, see P3-7) | `web/src/components/SourcesManager.tsx` | **DONE** | 3 component tests | Dynamic table of employer boards across Greenhouse, Ashby, Lever, Arbeitnow, +Add Board form, enable/disable toggle, per-source sync. |
| **S3-8** | Candidate Profile & Resume UI | `web/src/components/ProfileManager.tsx` | **DONE** | 3 component tests | Profile editor, skill tags management, PDF resume drag-and-drop upload and raw text paste parser with instant job rescoring feedback. |
| **S3-9** | Unified Multi-Tab Cockpit & Tailoring Preview | `web/src/components/Dashboard.tsx` | **DONE** | 6 component tests | Top navigation bar with 4 tabs (Job Discovery, Applications Pipeline, Target Companies, Profile & Resume) + inline "Tailor Resume" ATS preview. |

---

## Sprint 2 — Real Job Ingestion, Matching & Dashboard (VERIFIED & COMPLETED)


| ID | Description | Component | Status | Tests | Verification Summary |
|---|---|---|---|---|---|
| **S2-1** | Inspect & preserve baseline | Git / Security | **DONE** | Clean status | Git initialized, `.gitignore` protects secrets, baseline commit `77d5e4f` created. |
| **S2-2** | Open-source research & GitHub reuse | Connectors / Architecture | **DONE** | Documented | `docs/OPEN_SOURCE_RESEARCH.md`, `docs/THIRD_PARTY_COMPONENTS.md`, `docs/INTEGRATION_DECISIONS.md`. |
| **S2-3** | Real permitted ATS connectors | Greenhouse, Ashby, Arbeitnow | **DONE** | 5 unit + live | Implemented in `server/src/connectors/`. Live verified: Cloudflare (424 jobs), Linear (31 jobs), Arbeitnow (325 jobs). |
| **S2-4** | Ingestion, normalization & deduplication | `server/src/jobs/` | **DONE** | 4 integration tests | `processAndUpsertJob` cleans HTML, canonicalizes URLs, deduplicates via `[externalId, source]`. Idempotency verified: re-sync creates 0 duplicates. |
| **S2-5** | Enhanced explainable matching engine | `server/src/matching/engine.ts` | **DONE** | 8 unit tests | Distinguishes required vs preferred skills, disqualifies Senior/Staff roles for intern targets, checks graduation cohort (2027/2028), matches location. |
| **S2-6** | Scheduler & concurrency guard | `server/src/scheduler/cron.ts` | **DONE** | 2 tests | Wired into `server/src/index.ts`, background interval, signal traps (`SIGTERM`/`SIGINT`), duplicate execution protection. |
| **S2-7** | REST sync endpoints & observability | `server/src/api/sync.ts` | **DONE** | 4 tests | `POST /api/sync` triggers on-demand sync, `GET /api/sync/status` returns connector health and run history. Database records in `SyncRun` and `AuditLog`. |
| **S2-8** | Real-data Next.js dashboard | `web/src/components/Dashboard.tsx` | **DONE** | 6 tests | Consumes real API, search filter, category tabs (`ALL`, `APPLY`, `REVIEW`, `SKIP`), manual "Sync Jobs" button, verified source link, explainability breakdown. |

---

## Milestone 1 — Research & Foundation (COMPLETED)

| ID | Priority | Description | Owner | Status | Tests | Notes |
|---|---|---|---|---|---|---|
| M1-1 | 1 | Open-source repos & architecture research | Agent A | **DONE** | - | Documented in `OPEN_SOURCE_RESEARCH.md` |
| M1-2 | 1 | Architecture specification | Lead Architect | **DONE** | - | Monorepo structure, TypeScript-first, Prisma |
| M1-3 | 2 | Monorepo workspaces (`server/`, `web/`) | Agent B/C | **DONE** | - | npm workspaces configured |
| M1-4 | 2 | PostgreSQL Docker container setup | Agent F | **DONE** | Container health | PostgreSQL 15 on port `5433` (Docker Compose) |
| M1-5 | 2 | Scaffolding Express & Next.js App Router | Agent B/C | **DONE** | Health tests | Express API + Next.js App Router with Tailwind CSS |

---

## Milestone 2 — Job Intelligence (COMPLETED)

| ID | Priority | Description | Owner | Status | Tests | Notes |
|---|---|---|---|---|---|---|
| M2-1 | 3 | Generic `JobConnector` interface | Connector Agent | **DONE** | TypeScript types | `server/src/connectors/types.ts` |
| M2-2 | 3 | Basic RSS & JSON connectors | Connector Agent | **DONE** | Unit tests | Backward-compatible `jsonApi.ts` & `rss.ts` |
| M2-3 | 3 | Normalization & upsert pipeline | Backend Agent | **DONE** | Integration tests | `normalization.ts` with compound unique index |
| M2-4 | 3 | REST Jobs API & query filters | Backend Agent | **DONE** | API tests | `GET /api/jobs` with sorting and filtering |

---

## Milestone 3 — Candidate Profile & Matching (COMPLETED)

| ID | Priority | Description | Owner | Status | Tests | Notes |
|---|---|---|---|---|---|---|
| M3-1 | 2 | Prisma `CandidateProfile` model | Backend Agent | **DONE** | DB sync | JSON Resume standard fields (skills, education, experience) |
| M3-2 | 2 | Candidate Profile API | Backend Agent | **DONE** | 3 tests | `POST /api/profiles` with validation |
| M3-3 | 1 | Deterministic matching engine | Matching Agent | **DONE** | 8 tests | Score calculation, `APPLY` / `REVIEW` / `SKIP` classification |

---

## Milestone 4 — Dashboard & Application Tracking (COMPLETED)

| ID | Priority | Description | Owner | Status | Tests | Notes |
|---|---|---|---|---|---|---|
| M4-1 | 2 | `JobApplication` Prisma schema | Backend Agent | **DONE** | DB sync | `DRAFT`, `APPLIED`, `REJECTED`, `isApproved` flag |
| M4-2 | 2 | Applications REST API | Backend Agent | **DONE** | Integration tests | `GET /api/applications`, `POST /api/applications` |
| M4-3 | 2 | Next.js Dashboard UI | Frontend Agent | **DONE** | Component tests | Tailwind CSS job feed, detail panel, search, filters |

---

## Milestone 5 — Application Copilot & HITL Safety Gate (COMPLETED)

| ID | Priority | Description | Owner | Status | Tests | Notes |
|---|---|---|---|---|---|---|
| M5-1 | 1 | Document versioning schema | Backend Agent | **DONE** | DB sync | `Document` model for Resumes & Cover Letters |
| M5-2 | 1 | LLM Copilot generation endpoint | Backend Agent | **DONE** | 3 tests | `POST /api/copilot/generate` |
| M5-3 | 1 | Strict Human Approval Enforcement | Backend Agent | **DONE** | Security test | Hardcoded `403 Forbidden` if `isApproved !== true` |
| M5-4 | 1 | Application Review UI | Frontend Agent | **DONE** | Component tests | `ApplicationCopilot.tsx` with approval checkbox |

---

## Milestone 6 — Scheduler, Lifecycle & Email (COMPLETED)

| ID | Priority | Description | Owner | Status | Tests | Notes |
|---|---|---|---|---|---|---|
| M6-1 | 2 | Background Scheduler with concurrency guard | Backend Agent | **DONE** | 2 tests | `server/src/scheduler/cron.ts` |
| M6-2 | 2 | Email Classification Engine | Backend Agent | **DONE** | 3 tests | `server/src/email/gmail.ts` (INTERVIEW, REJECTION, UNKNOWN) |
| M6-3 | 2 | Ingestion run tracking | Backend Agent | **DONE** | Integration tests | `SyncRun` table with execution metrics |

---

## Milestone 7 — DevOps, Security & Hardening (COMPLETED)

| ID | Priority | Description | Owner | Status | Tests | Notes |
|---|---|---|---|---|---|---|
| M7-1 | 1 | Automated DB Backup (`scripts/backup.sh`) | DevOps Agent | **DONE** | Shell verified | Atomic `pg_dump` with SHA256 checksum & 0600 permissions |
| M7-2 | 1 | Automated DB Restore (`scripts/restore.sh`) | DevOps Agent | **DONE** | Shell verified | Pre-flight validation, clean restore, `--force` flag |
| M7-3 | 1 | Security & Trust Boundaries (`docs/SECURITY.md`) | Security Agent | **DONE** | Documented | Audit logging, prompt injection defense, HITL gate |

---

## Operational Commands Reference

### 1. Start Database Container
```bash
docker compose up -d
```

### 2. Run All Automated Tests
```bash
npm run test:server
npm run test:web
```

### 3. Production Compiles
```bash
npm run build -w server
npm run build -w web
```

### 4. Trigger Live Job Synchronization (CLI)
```bash
curl -X POST http://localhost:3001/api/sync -H "Content-Type: application/json" -d '{"force": true}'
```

### 5. Check Live Ingestion & Health Status
```bash
curl http://localhost:3001/api/sync/status
curl http://localhost:3001/api/sources
curl http://localhost:3001/health
```

### 6. Create Database Backup
```bash
./scripts/backup.sh
```

