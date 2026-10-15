# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Job Agent is a job-search automation system: it ingests job listings from many sources, scores them against a candidate profile, tracks applications through a pipeline, tailors cover letters/answers with Gemini, runs Wellfound auto-apply via Playwright, and keeps a networking CRM fed by Gmail sync.

npm workspaces monorepo:
- `server/` — Express 5 + TypeScript API, Prisma (PostgreSQL), background scheduler
- `web/` — Next.js 16 (App Router, Turbopack) + React 19 + Tailwind 4 dashboard
- `wellfound_autoApply/`, `job-auto-apply/` — **git submodules** (third-party repos), plain Node/Playwright scripts; not workspaces, they have their own `npm install`
- `scripts/wellfound/` — builds a self-contained browser-console bundle from the Wellfound automation

## Commands

```bash
docker compose up -d postgres        # Postgres on localhost:5433 (not 5432)
npm install                          # installs server + web workspaces
cd server && npx prisma db push      # sync schema (no migrations dir; db push is the workflow)

npm run dev:server                   # tsx watch, port 3001
npm run dev:web                      # next dev, port 3000

npm run test:server                  # vitest (node)
npm run test:web                     # vitest (jsdom + Testing Library)
npm run build:server                 # tsc
npm run build:web                    # next build
npm run lint -w web                  # eslint (web only; server has no linter)

# single test file / single test
npm run test -w server -- src/__tests__/applications.test.ts
npm run test -w server -- -t "should create and fetch an application"
npm run test -w web -- src/components/Dashboard.test.tsx

docker compose up -d --build         # full stack (db + server + web)
```

Wellfound automation: `npm run wellfound:install`, `wellfound:login` (saves session), `wellfound:dry-run[:visible]`, `wellfound:live[:visible]`, `wellfound:zen` (console bundle).

## Important gotchas

- **Server tests hit the real database.** They import `app`/`prisma` and call `deleteMany()` on tables in `beforeAll` against whatever `DATABASE_URL` points to (loaded from the root `.env`). Running `test:server` wipes local dev data. `server/vitest.config.ts` disables file parallelism for this reason — keep it that way.
- The root `.env` is the single env file: `server/src/app.ts` loads `../../.env` explicitly. Key vars: `DATABASE_URL`, `GEMINI_KEY`, `GMAIL_CLIENT_ID/SECRET/REDIRECT_URI`, `SYNC_INTERVAL_MINUTES` (default 60), `DISABLE_SCHEDULER`. The Wellfound API (`server/src/api/wellfound.ts`) also reads/writes candidate-profile vars into `.env` files.
- `web/AGENTS.md`: this Next.js version has breaking changes vs. training data — read the guides in `web/node_modules/next/dist/docs/` before writing Next.js code. `next dev` regenerates that file.
- Live Wellfound mode submits real applications. Default to dry-run when testing automation.
- Root `applications.csv` and `apply-state-wellfound.json` are symlinks into `wellfound_autoApply/`; the state file holds session cookies.

## Architecture

**Server request flow:** `index.ts` starts the HTTP server, then (unless `NODE_ENV=test` or `DISABLE_SCHEDULER=true`) starts the scheduler and runs an initial Wellfound CSV sync. `app.ts` builds the Express app (exported separately so supertest can use it without listening) and mounts every router under `/api` (`sources` under `/api/sources`). `db.ts` exports a single shared `PrismaClient`.

**Ingestion pipeline:** `connectors/` holds one module per source (Greenhouse, Ashby, Lever, Arbeitnow, JSON API, RSS, Wellfound, LinkedIn) sharing `types.ts`/`utils.ts`. Sources are configured in the DB (`JobSourceConfig`). `jobs/syncService.ts` runs connectors, normalizes via `jobs/normalization.ts`, scores via `matching/engine.ts` (0–100 score + APPLY/REVIEW/PASS), and records a `SyncRun`. `scheduler/cron.ts` runs this on an interval and also triggers the daily briefing (`briefing/summary.ts`) at 8 PM IST.

**Wellfound integration:** the server doesn't reimplement auto-apply. `api/wellfound.ts` spawns `wellfound_autoApply/auto-apply-runner.js` as a child process (tracking a single in-memory runner state and streaming logs), and `connectors/wellfoundAutoApplyService.ts` parses the runner's `applications.csv` into `JobListing` + `JobApplication` (stage `APPLIED`) + `NetworkingContact` rows. CSV path resolution tries several workspace and Docker (`/app/...`) locations; docker-compose mounts `wellfound_autoApply/` and `scripts/` into the server container.

**AI:** Gemini calls live in `resumes/tailor.ts` (cover letters/tailoring, used by `api/copilot.ts`); `resumes/parser.ts` parses uploaded PDFs.

**Email/CRM:** `email/` handles Gmail OAuth (`gmail.ts`), rule-based classification of messages (`classifier.ts`), and syncing into `EmailEvent` / pipeline / `networking/crm.ts`.

**Web:** essentially a single page (`app/page.tsx` → `components/Dashboard.tsx`) that switches between feature components (`ProfileManager`, `SourcesManager`, `ApplicationsPipeline`, `ApplicationCopilot`, `NetworkingCrm`, `GmailSync`, `DailyBriefing`, `WellfoundAutoApplyManager`). Components call the API directly with `fetch` against `NEXT_PUBLIC_API_URL` (default `http://localhost:3001`); there is no shared API client. Each component has a colocated `*.test.tsx`.

**Tests:** server tests are in `server/src/__tests__/`, colocated `*.test.ts` files, and `server/tests/`. Use supertest against `app` for API tests.

Further design notes: `docs/ARCHITECTURE.md`, `docs/INTEGRATION_DECISIONS.md`, `docs/SECURITY.md`.
