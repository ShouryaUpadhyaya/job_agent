# Architecture

Job Agent is a single-user application that runs on the user's machine. It has three runtime
parts and one optional helper:

| Part | Tech | Port | Notes |
| --- | --- | --- | --- |
| Database | PostgreSQL 15 (Docker) | 5433 on the host | Schema in `server/prisma/schema.prisma`, applied with `prisma db push` |
| API server | Express 5, TypeScript, Prisma | 3001 | REST under `/api`, in-process scheduler |
| Dashboard | Next.js 16, React 19, Tailwind 4 | 3000 | One page with seven tabs |
| Wellfound host agent | Node, `scripts/wellfound/agent.js` | 3002 | Only needed when the server runs in Docker |

External calls: official job-board APIs, the GitHub REST API, the Gmail API (read-only), and
Gemini (optional). Nothing calls LinkedIn or Naukri.

## Server modules

```
server/src/
  index.ts, app.ts, db.ts   startup, Express app, shared PrismaClient
  lib/                      company.ts (companyKey), stages.ts (canTransition), time.ts (IST),
                            profile.ts (active profile/resumes), gemini.ts (single client)
  api/                      one router per area, all mounted under /api
  connectors/               job APIs + registry (DEFAULT_SOURCES), paste-import normalisers,
                            wellfoundAutoApplyService.ts (CSV → pipeline)
  discovery/                jobAlerts.ts, searchLinks.ts, xSources.json
  jobs/                     syncService.ts, normalization.ts, liveness.ts
  matching/                 skills.ts, engine.ts, resumeScoring.ts
  resumes/                  parser.ts, service.ts, rescore.ts, tailor.ts
  applications/             service.ts (read model), fit.ts, audit.ts
  networking/               contacts, crm, priority, parse, peopleLinks, github, messages
  email/                    service (OAuth + sync), oauthState, query, mime, classifier,
                            refine, effects, summary, demo, config
  briefing/                 build.ts, inShort.ts, render.ts, summary.ts
  wellfound/                runService.ts, config.ts, diagnostics.ts, paths.ts, envFile.ts
  scheduler/cron.ts         ConnectorScheduler + DailyBriefingTrigger
  scripts/                  maintenance scripts (dry run unless --apply)
```

## Main data model

| Model | Purpose |
| --- | --- |
| `CandidateProfile` | The single active profile: contact, links, preferences, skills, education, experience, application answers (incl. Wellfound rules) |
| `Resume` | Several per profile: label, target category, content, skills, default flag |
| `JobListing` | Unique on `[externalId, source]`; score, classification, `bestResumeId`, `scoresByResume`, `publishedAt`, `lastSeenAt`, `isActive`/`closedAt`, `isInternship`, `companyKey`, `userStatus` (NONE/SAVED/DISMISSED) |
| `JobSourceConfig`, `SyncRun` | Configured sources and per-run results |
| `JobApplication` | Stage (BOOKMARKED … OFFERED/REJECTED/ARCHIVED), `source`, `companyKey`, `submittedAt`, `lastEmailAt`, notes |
| `NetworkingContact`, `NetworkingMessage` | Real contacts (source MANUAL/GMAIL/GITHUB/IMPORT, persona, school, URLs, email + `emailSource`) and their drafts |
| `ConnectedAccount`, `EmailEvent` | Gmail tokens/status; classified emails (`isDemo`, importance, links to application/contact) |
| `DailyJobSearchSummary` | One briefing per IST day (markdown + embedded JSON) |
| `WellfoundRun` | Mode, status, times, exit code, log path, diagnostics dir, submitted count |
| `AuditLog`, `Document` | Stage-change/creation trail; generated documents |

## Data flows

**Job ingestion.** `syncService.syncAll()` runs every enabled source, isolating failures per
source. Each listing goes through `normalization.ts` (HTML cleanup, URL canonicalisation, upsert
on `[externalId, source]`, `lastSeenAt` refresh) and `resumeScoring.ts` (score against each
resume, keep the best). After a successful feed sync, `liveness.recordFeedSync` closes listings
missing from two consecutive syncs. Job-alert emails enter through `discovery/jobAlerts.ts` with
`source = email:<site>`; pasted jobs through `POST /api/jobs/import`.

**Rescoring.** Profile and resume edits call `rescoreAllJobs()`; a request during a run queues
exactly one more pass.

**Stage changes.** Every writer of `JobApplication.stage` (manual PATCH, Gmail effects, Wellfound
CSV import) uses `canTransition(from, to, source)`. Automated sources are forward-only and never
leave OFFERED/REJECTED/ARCHIVED. Changes and creations are recorded by `applications/audit.ts`.

**Gmail.** `GET /api/gmail/auth-url` issues a single-use `state`; the callback verifies it,
stores tokens on `ConnectedAccount`, and redirects to `?tab=GMAIL`. `syncInbox()` builds a
curated query from `lastSyncedAt` (minus a day) or the initial lookback, pages oldest-first,
skips stored message IDs, classifies, stores the `EmailEvent`, then applies `effects.ts` once.
Auth failures mark the account `EXPIRED`. Only one sync runs at a time.

**Wellfound.** The UI calls `POST /api/wellfound/runs`. `runService` creates a `WellfoundRun`,
then either spawns `scripts/wellfound/runner.js` (local executor) or asks the host agent to
(agent executor). The runner writes `logs/wellfound/<runId>.log` and
`diagnostics/wellfound/<runId>/`; the API streams the log over SSE
(`/runs/:id/stream`, polling fallback `/runs/:id/log?offset=`). After a live run the CSV is
imported into the pipeline.

**Scheduler.** Every `SYNC_INTERVAL_MINUTES`: job sync → liveness check of up to 40 listings
older than 7 days → Wellfound CSV import → Gmail sync (if connected and `GMAIL_AUTO_SYNC` is not
false). Separately, `DailyBriefingTrigger` checks every 5 minutes (and on start) and generates
the briefing once per IST day at or after 20:00 IST, catching up if 20:00 was missed.

## Web

`web/src/app/page.tsx` renders `components/Dashboard.tsx`, which keeps the active tab in `?tab=`.
Record deep links (`?tab=PIPELINE&id=…`, `?tab=NETWORKING&companyKey=…`, etc.) are parsed by
`web/src/lib/urlParams.ts`; each tab highlights (and fetches if needed) the linked record. The
briefing and Gmail summary emit these links.
Tabs: Job Discovery (with the Manage sources drawer), Wellfound AutoApply, Application Pipeline,
Networking CRM, Gmail, Daily Briefing, Profile & Resume. Each tab is a top-level component plus a
folder of subcomponents. All requests go through `web/src/lib/api.ts`.

## Design decisions

- Official public APIs instead of scraping; LinkedIn/Naukri only through emails, links and paste
  (see `SECURITY.md`).
- Deterministic, explainable matching instead of embeddings (`INTEGRATION_DECISIONS.md`).
- In-process scheduler with database-backed state instead of an external queue.
- Gemini is optional everywhere; each AI feature has a template fallback.
- Wellfound automation runs on the host where Chrome and a display exist; the container only
  proxies to it.
