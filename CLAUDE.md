# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Job Agent is a single-user, local job-search assistant for an Indian CS student targeting internships: it ingests listings from official job APIs and job-alert emails, scores them against multiple resumes, runs Wellfound auto-apply on the user's own Chrome (dry run by default), tracks applications, keeps a networking CRM of real contacts, classifies Gmail and builds a 20:00 IST daily briefing. User-facing docs: `README.md`.

npm workspaces monorepo:
- `server/` — Express 5 + TypeScript API, Prisma (PostgreSQL), in-process scheduler
- `web/` — Next.js 16 (App Router, Turbopack) + React 19 + Tailwind 4 dashboard
- `scripts/wellfound/` — repo-owned Wellfound runner, host agent, preflight and console-script build
- `wellfound_autoApply/`, `job-auto-apply/` — **git submodules** (third-party, kept unmodified), own `npm install`; not workspaces. The app only uses `wellfound_autoApply/` (patched in memory at build time).

## Commands

```bash
docker compose up -d postgres        # Postgres on localhost:5433 (not 5432)
npm install                          # server + web workspaces
cd server && npx prisma db push      # sync schema (no migrations; needs server/.env -> ../.env symlink or DATABASE_URL)

npm run dev:server                   # tsx watch, port 3001
npm run dev:web                      # next dev, port 3000
docker compose up -d --build         # full stack (db 5433, server 3001, web 3000)

npm run test:server                  # vitest against the derived <db>_test database
npm run test:web                     # vitest (jsdom + Testing Library)
npm run build:server && npm run build:web
npm run lint -w web                  # eslint (web only; server has no linter)

# single test file / single test
npm run test -w server -- src/__tests__/applicationsPipeline.test.ts
npm run test -w server -- -t "never downgrades"
npm run test -w web -- src/components/Dashboard.test.tsx
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5433/job_agent_test_x?schema=public" npm run test:server
```

Wellfound: `npm run wellfound:install`, `wellfound:login` (saves session), `wellfound:preflight`, `wellfound:agent` (127.0.0.1:3002) / `wellfound:agent:docker` (0.0.0.0, requires `WELLFOUND_AGENT_TOKEN`), `wellfound:dry-run[:visible]`, `wellfound:live[:visible]`, `wellfound:zen[:live]`. Reference: `scripts/wellfound/README.md`.

Maintenance (from `server/`, dry run unless `--apply`; `pg_dump` first via `./scripts/backup.sh`): `npx tsx src/scripts/{cleanupFakeJobs,cleanupFakeContacts,cleanupDemoEmails,migrateResumes}.ts [--apply]`; `backfillCompanyKeys.ts` writes immediately (idempotent); `npx tsx src/seed.ts` only creates a missing profile.

## Rules for changes

- **Compliance is a hard requirement.** Never add code that requests linkedin.com or naukri.com (scraping, guest APIs, server-side URL fetches, liveness checks, automated messages). Those sites reach the app only via job-alert emails, user-opened search links and pasted details. `connectors/utils.ts` `isRestrictedHost` guards feeds and liveness. Job boards: official public APIs only. X: links only.
- **Never fabricate data**: no sample jobs, generated contacts/leads, placeholder people or guessed email patterns. Contact emails come only from Gmail senders, user input or a GitHub-published address. Demo emails exist only behind the explicit demo action, flagged `isDemo` and excluded everywhere.
- **Wellfound live safety**: builds default to dry run and always write `DRY_RUN` explicitly; `GET /wellfound/script` and `PUT /wellfound/config` never build live; `startRun` rejects `LIVE` without `confirmLive: true`. Never start a live run when testing. Never send `GEMINI_KEY` to the browser (only embedded in the Zen bundle with `includeKey=1`).
- No Co-Authored-By / AI attribution in commits.

## Important gotchas

- **Tests use an isolated DB.** `server/vitest.test-db.mts` derives `<db>_test` from `DATABASE_URL` (or uses `TEST_DATABASE_URL`) and refuses names without `test`; `vitest.global-setup.mts` creates it and runs `prisma db push`. Tests still `deleteMany()` tables, so `fileParallelism: false` must stay. Tests run with `GEMINI_KEY=''` and `DISABLE_SCHEDULER=true`; mock `fetch` for connectors/Gemini/GitHub.
- The root `.env` is the single env file: `server/src/app.ts` loads `../../.env`. `PUT /wellfound/config` may write `GEMINI_KEY` into it.
- **IST everywhere**: use `lib/time.ts` (`istDateKey`, `istStartOfDay`, …) for any "today"/day-boundary logic — briefing keys, Wellfound daily cap, CSV dates. Never use UTC midnight or server-local dates.
- **Stage changes**: automated writers (Gmail, Wellfound CSV, imports) must go through `lib/stages.ts` `canTransition(from, to, source)` — forward-only, never out of OFFERED/REJECTED/ARCHIVED; `manual` can set anything. Keep `status` in sync with `statusForStage`. Record changes/creations with `applications/audit.ts` (the briefing reads the audit log).
- **Company joins** (pipeline ↔ contacts ↔ Gmail ↔ Wellfound) use `companyKey()` from `lib/company.ts`, not raw names. Set `companyKey` on every new listing/application/contact.
- Use `lib/profile.ts` (`getActiveProfile`/`ensureActiveProfile`, `getProfileResumes`) instead of `prisma.candidateProfile.findFirst()`. Profile saves are partial (never wipe `rawResume`); profile/resume edits must trigger `resumes/rescore.ts`.
- Gemini only through `lib/gemini.ts` (`x-goog-api-key` header, model fallback, timeouts, returns null → callers must have a template fallback; wrap untrusted text in delimiters).
- Listings with `source = 'email'` are placeholders from application-confirmation emails; `api/jobs.ts` hides them from Discovery. Job-alert listings use `email:<site>`.
- `web/AGENTS.md`: this Next.js version has breaking changes vs. training data — read `web/node_modules/next/dist/docs/` before writing Next.js code.
- Root `applications.csv` and `apply-state-wellfound.json` are symlinks into `wellfound_autoApply/`; the Chrome session lives in `wellfound_autoApply/.wellfound-chrome-profile/`. `logs/` and `diagnostics/` are git-ignored and mounted read-only into the server container (the host agent writes them).

## Architecture

**Server:** `index.ts` listens, then (unless `NODE_ENV=test`/`DISABLE_SCHEDULER=true`) starts the scheduler, imports the Wellfound CSV and reconciles interrupted runs. `app.ts` builds the Express app (exported for supertest) and mounts every router under `/api` (`sources` under `/api/sources`). `db.ts` exports the shared `PrismaClient`.

**`lib/`:** `company.ts` (companyKey), `stages.ts` (order, `canTransition`), `time.ts` (IST), `profile.ts` (active profile/resumes), `gemini.ts` (single client).

**Discovery:** `connectors/` has one module per official API (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Remotive, Remote OK, Arbeitnow, RSS, JSON); `registry.ts` holds supported types, `DEFAULT_SOURCES` and `createConnector`. `linkedin.ts`/`wellfound.ts` only normalise pasted imports. `jobs/syncService.ts` runs sources (per-source failure isolation, `SyncRun`), `jobs/normalization.ts` upserts on `[externalId, source]`, `jobs/liveness.ts` closes listings missing from 2 feed syncs and rechecks stale ones via ATS APIs. `discovery/jobAlerts.ts` parses alert emails, `searchLinks.ts` builds prefilled searches, `xSources.json` lists X accounts. `api/jobs.ts`: filters, sorts, facets, pagination, user status, paste-only imports.

**Matching:** `matching/skills.ts` (vocabulary + aliases, word-boundary extraction), `engine.ts` (0–100 score, APPLY ≥ 60 / REVIEW ≥ 35 / SKIP, seniority, grad year, location, freshness), `resumeScoring.ts` (scores every resume, sets `bestResumeId`/`scoresByResume`). `resumes/` has the PDF parser, resume CRUD service, `rescore.ts` (queued rerun) and `tailor.ts`.

**Wellfound:** `wellfound/runService.ts` owns the run lifecycle (`WellfoundRun` rows, log files, SSE tail, stop, reconcile) with a `LocalExecutor` (spawns `scripts/wellfound/runner.js`) or `AgentExecutor` (HTTP to `scripts/wellfound/agent.js` with `x-agent-token`); `WELLFOUND_EXECUTOR=auto|local|agent`. `wellfound/config.ts` maps profile + rules to runner config, `diagnostics.ts` lists/serves artifacts (HTML served as a sandboxed attachment). `connectors/wellfoundAutoApplyService.ts` imports `applications.csv` forward-only and idempotently.

**Pipeline:** `applications/service.ts` (filters, sorts fit/match/alumni/recent/applied/company, people counts by companyKey, duplicate guard), `applications/fit.ts` (pure fit score with breakdown), `applications/audit.ts`.

**Networking:** `networking/contacts.ts` (CRUD, dedupe/merge, filters, sorts), `crm.ts` (status transitions), `priority.ts` (score + breakdown), `parse.ts` (headline → persona/school/company, URL validation), `peopleLinks.ts` (search links), `github.ts` (public org members, cached), `messages.ts` + `messagePrompts.ts` (drafts per `docs/NETWORKING_PLAYBOOK.md`, Gemini or template).

**Email:** `email/service.ts` (OAuth with `oauthState.ts`, token persistence/refresh, revoke, incremental sync with one-at-a-time guard), `query.ts` (Gmail search), `mime.ts`, `classifier.ts` (12 classes, ATS-aware, deadlines, importance), `refine.ts` (optional Gemini for low confidence), `effects.ts` (stage/contact/job-alert side effects, once per message), `summary.ts`, `demo.ts`, `config.ts` (env names incl. legacy `GOOGLE_*`).

**Briefing:** `briefing/build.ts` (structured sections), `inShort.ts`, `render.ts` (markdown + embedded JSON), `summary.ts` (service, one row per IST day, `isScheduledRunDue`).

**Scheduler (`scheduler/cron.ts`):** `ConnectorScheduler` every `SYNC_INTERVAL_MINUTES`: job sync → liveness (40 listings > 7 days) → Wellfound CSV import → Gmail sync (`GMAIL_AUTO_SYNC`, connected only). `DailyBriefingTrigger` checks every 5 min and on start; generates once at/after 20:00 IST with catch-up and 30-min backoff after failure.

**Web:** `app/page.tsx` → `components/Dashboard.tsx`, tabs synced to `?tab=` (DISCOVERY, WELLFOUND, PIPELINE, NETWORKING, GMAIL, BRIEFING, PROFILE; `?tab=SOURCES` opens the Discovery sources drawer). Each tab has a top-level component plus a folder (`discovery/`, `wellfound/`, `pipeline/`, `networking/`, `gmail/`, `briefing/`, `profile/`). All requests go through `lib/api.ts` (`NEXT_PUBLIC_API_URL`, default `http://localhost:3001`). Tests are colocated `*.test.tsx`.

**Tests:** server tests in `server/src/__tests__/`, colocated `*.test.ts`, and `server/tests/`; supertest against `app`.

Further notes: `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/JOB_SOURCES.md`, `docs/IMPLEMENTATION_STATUS.md`.
