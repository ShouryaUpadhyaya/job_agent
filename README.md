# Job Agent

A personal job-search assistant for an Indian CS student looking for software internships and
fresher roles. It runs on your own machine and keeps everything in one dashboard:

- jobs from official public job APIs and your own job-alert emails, scored against your resumes;
- a Wellfound auto-apply runner that drives your own logged-in Chrome (dry run by default);
- an application pipeline, a networking CRM for real people, Gmail tracking and a daily briefing.

It is a single-user tool. There is no login, and the API is meant to be reached only from
`localhost`.

Stack: Express 5 + TypeScript + Prisma/PostgreSQL (`server/`), Next.js 16 + React 19 + Tailwind 4
(`web/`), Playwright for Wellfound (`scripts/wellfound/`), and optionally Gemini for text generation.

---

## Contents

- [Features](#features)
- [Compliance: what Job Agent does not do](#compliance-what-job-agent-does-not-do)
- [Setup](#setup)
- [Environment variables](#environment-variables)
- [First-run checklist](#first-run-checklist)
- [Wellfound AutoApply how-to](#wellfound-autoapply-how-to)
- [Gmail setup](#gmail-setup)
- [Maintenance scripts and backups](#maintenance-scripts-and-backups)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Further documentation](#further-documentation)

---

## Features

The dashboard (`http://localhost:3000`) has seven tabs. The active tab is kept in the URL
(`?tab=DISCOVERY`, `?tab=GMAIL`, …), so links and OAuth redirects land on the right view.

### Job Discovery

- **Sources.** Official public posting APIs only: Greenhouse, Lever, Ashby, SmartRecruiters,
  Workable, Remotive, Remote OK and Arbeitnow, plus generic RSS/JSON feeds. A curated default list
  of companies that hire interns in India (or remotely) is seeded automatically and was verified
  against each live API; see [docs/JOB_SOURCES.md](docs/JOB_SOURCES.md). Sources are managed in
  the **Manage sources** drawer (add, enable/disable, per-source sync and status). The old
  "Target Companies" / "Job Sources" tab was folded into this drawer; `?tab=SOURCES` links still
  open it.
- **Email job alerts.** LinkedIn, Naukri, Internshala, Wellfound and Instahyre job-alert emails
  in your Gmail are parsed locally into listings (`source = email:<site>`). This is how LinkedIn
  and Naukri jobs get in. You can also paste an alert email's content by hand.
- **Add job manually.** Paste a URL, title, company and description from any site. The URL is
  stored, never fetched.
- **Matching.** A deterministic 0–100 score with an APPLY / REVIEW / SKIP label and "why matched"
  reasons. Skills are matched on word boundaries with an alias map (Java is not JavaScript,
  "intern" is not "international"). It checks seniority (Sr., II/III, "N+ years"), your
  graduation year and locations from the profile, boosts internship/fresher titles, decays with
  age, penalises non-engineering roles and country-restricted remote jobs, and lists real
  missing skills.
- **Multi-resume best match.** Every job is scored against each of your resumes; the best one is
  recorded and shown ("best with: Backend"). Editing the profile or a resume rescores all jobs.
- **Filters and sorts.** Internship only, saved only, hide applied, show dismissed, posted within
  N days, location, remote only, min score, classification, best resume, sources, active only,
  and text search. Sorts: best match, newest, company. Save and dismiss buttons, "Applied"
  markers and server-side pagination.
- **Liveness.** A listing missing from two consecutive successful syncs of its source is closed.
  After each scheduled sync, listings older than 7 days are rechecked through the ATS per-job API
  (or a plain GET for other hosts) and closed on 404/410 or a "no longer accepting" page.
  LinkedIn and Naukri pages are never fetched; email-sourced listings show an age label instead.
- **Search elsewhere.** Prefilled searches you open yourself: LinkedIn Jobs (internship, past
  week, India/remote, your top skills), Naukri, Internshala, Wellfound, Instahyre (via Google),
  Google `site:` searches of Greenhouse/Lever/Ashby boards, and an X search for internship posts.
- **X feeds.** An "Opportunity feeds on X" card links to accounts that post Indian intern/fresher
  openings ([docs/X_SOURCES.md](docs/X_SOURCES.md)). There is no X ingestion (the API is paid and
  scraping is not allowed).

### Wellfound AutoApply

- Applies to intern/fresher engineering roles on wellfound.com from **your own** Chrome session,
  using Playwright and a patched copy of the upstream console script.
- **Host agent.** When the server runs in Docker (no Chrome, no display), runs go through a small
  agent on your desktop (`npm run wellfound:agent:docker`). When the server runs on the host, it
  spawns the runner itself.
- **Dry run vs live.** Dry run is the default: it opens jobs, fills the form and logs
  `DRY_RUN — would click: Apply` without submitting. Live mode needs you to type `APPLY` in the
  UI, and the API rejects a live run without an explicit `confirmLive: true`.
- **Run tab:** preflight checklist (agent, Chrome, display, saved session, script build), mode,
  batch size (capped at the daily cap minus today's count in IST), visible/trace options, and
  live logs streamed over SSE that stay readable after the run ends.
- **History & Diagnostics:** every run is stored with its log. On failures the runner saves a
  screenshot, page HTML, URL and JSON context (and an optional Playwright trace) per run.
- **Applied:** the rows of `applications.csv`. After a live run the CSV is imported into the
  pipeline, forward-only and idempotent.
- **Profile & Rules:** the answers, highlights and rules the runner uses come from your profile in
  the database (daily cap, terms-box auto-tick, etc.).
- **Zen script:** a paste-into-DevTools bundle (dry run unless you ask for live; the Gemini key is
  embedded only if you tick "Embed my Gemini key").

### Application Pipeline

- Stages: Bookmarked → Applying → Applied → Interviewing → Offered / Rejected, plus Archived.
  Manual edits can set any stage; Gmail and the Wellfound CSV can only move an application
  forward and never out of Rejected/Offered/Archived. Every stage change and creation is written
  to an audit log, which the briefing reads.
- **Fit score** (0–100), shown with a breakdown tooltip: resume match (45), VIT alumni at the
  company (20), other contacts there (10), listing still live and fresh (10), stage (10), recent
  email activity (5). Rejected and archived applications get 0 and sink to the bottom.
- **Sorts:** fit, match, alumni, recent, applied date, company. **Filters:** stage, source, has
  alumni, text search.
- **List or board view** with optimistic edits, notes, dates and the last email.
- **People strip** on each card: contacts at that company (joined by normalised company name),
  quick add, "Find people" links, and "Draft referral ask".
- Adding a job that is already in the pipeline says so instead of creating a duplicate.

### Networking CRM

- **Real contacts only.** People come from what you add, from recruiter emails in Gmail, or from
  public GitHub profiles. Nothing is generated; emails come only from your Gmail senders, what
  you type, or an address the person published on GitHub. Email patterns are never guessed.
- **Find people:** per company, links you open yourself: LinkedIn people searches (company + VIT,
  and by persona: engineer, full-stack, recruiter, founder/CTO), a Google X-ray search and an X
  people search.
- **GitHub discovery:** public members of the company's GitHub org via the GitHub API, with only
  the fields they published. Add one with a click. `GITHUB_TOKEN` raises the rate limit.
- **Quick add:** paste a LinkedIn `/in/` URL, name and headline (plus optional X, email, notes).
  The headline is parsed into persona, school and company. Duplicates are detected (LinkedIn URL,
  or name + company) and can be merged.
- **Priority score** with a visible breakdown: VIT alumni, engineer/full-stack/manager/recruiter/
  founder persona, whether you have applied there, recent postings at the company, and a penalty
  when a follow-up got no reply.
- **Statuses:** all 11 (Researched … Referred, Not interested, Follow-up due), with filters by
  company, persona, alumni, status, source and follow-up due; sorts by priority, recent, company,
  follow-up.
- **Message drafts:** connection note (≤ 300 characters), referral ask (≤ 120 words, includes the
  job link), follow-up (offered 5–7 days after a sent message, once) and thank-you. Gemini writes
  them from your profile, the contact, the job and the best resume when `GEMINI_KEY` is set;
  otherwise templates built from your real profile are used. Drafts can be copied and marked
  sent. Nothing is sent for you. The rules come from
  [docs/NETWORKING_PLAYBOOK.md](docs/NETWORKING_PLAYBOOK.md).

### Gmail

- Read-only Gmail access (OAuth). Setup is below.
- **Sync** is incremental and idempotent: a curated query (ATS and job-site senders plus job
  subject phrases), oldest first, skipping messages already stored. The first sync looks back
  `GMAIL_INITIAL_LOOKBACK_DAYS`; each run processes at most `GMAIL_SYNC_MAX_MESSAGES`. Besides
  **Sync now**, the scheduler syncs the inbox on every tick while Gmail is connected
  (`GMAIL_AUTO_SYNC=false` turns that off). Only one sync runs at a time.
- **Classification** into 12 classes (application confirmation, assessment, interview,
  rejection, offer, recruiter outreach, referral response, LinkedIn connection accepted,
  follow-up required, job alert, unrelated, unknown), with ATS awareness (the company comes from
  the subject/body, not from `greenhouse-mail.io`), deadlines and importance. Low-confidence
  emails get an optional Gemini second opinion.
- **Effects:** confirmations create or advance applications (a confirmation for a job not in
  Job Agent creates a placeholder listing that only appears in the pipeline, never in
  Discovery); interviews, rejections and offers
  move stages forward only (and only at high confidence); assessments add a dated note;
  LinkedIn "accepted" emails update the matching contact; recruiter replies from real people
  become contacts; job alerts become listings in Discovery.
- **Summary panel:** what needs action (interviews/assessments with deadlines, recruiter replies,
  offers), applications that moved because of email, and counts. Filters for every
  classification, links from emails to their application or contact, and connection health
  (an expired token shows as **Expired** with the fix).
- **Demo data** is a separate, labelled action ("Load demo events"). Demo rows are flagged,
  excluded everywhere by default and never touch real applications or contacts. A failed sync
  never inserts demo data.

### Daily Briefing

- One briefing per IST day, generated at **20:00 IST**. The trigger checks every 5 minutes and on
  server start, so a missed 20:00 (server off, long sync) is caught up later that evening.
- Sections, in order: **In short** (2–3 sentences; Gemini rewrites it when configured),
  **Today's actions** (interviews and assessments with deadlines, recruiter replies, follow-ups
  due), **People to message today** (top 3 at companies you applied to, alumni first),
  **New matches** (top 5 new active listings you haven't applied to, with the best resume),
  **Pipeline movement today**, **Wellfound auto-apply** runs, **Stale applications** (14+ days
  with no response) and **this week vs last week** stats.
- Items deep-link to the relevant tab. You can view a live (unsaved) version, regenerate, and
  browse history by IST date.

### Profile & Resumes

- **System overview:** active jobs by source and freshness, internships, APPLY/REVIEW counts,
  applications by stage, response rate, contacts by status and alumni, last sync per source,
  Gmail status and the last Wellfound run.
- **Profile editor:** contact, links, preferences (locations, remote, graduation year, target
  role), skills (add and remove), education, experience/projects and application answers. The
  matching engine and Wellfound runner both read this.
- **Multiple resumes:** upload a PDF or paste text, label it (e.g. "Backend", "Full-stack"), set
  a target category and a default. Each shows its parsed skills and how many active jobs it is
  the best match for.

From a job's detail view, **Tailor resume** suggests keywords and bullets grounded in the job's
best resume (`/api/copilot/tailor-resume`), and **Apply with copilot** opens an editable
cover-letter draft built from your profile. The copilot API can also generate cover letters and
screening answers. Nothing is submitted to the employer from here: you apply on the employer's
site yourself.

---

## Compliance: what Job Agent does not do

These are deliberate design rules, not missing features.

- **No LinkedIn or Naukri automation.** Nothing in the app requests linkedin.com or naukri.com:
  no scraping, no guest API, no server-side URL fetch, no liveness checks, and no automated
  connection requests or messages. LinkedIn/Naukri jobs arrive through their job-alert emails,
  prefilled search links you open yourself, or details you paste. RSS/JSON sources pointing at
  those hosts are rejected, and old LinkedIn/Wellfound connector rows are disabled.
- **No fabricated data.** No sample jobs, no generated "leads", no placeholder contacts. The
  former "Generate leads" endpoint now only returns search links.
- **No guessed emails.** A contact's email comes from a Gmail sender, your own input, or what the
  person published on GitHub.
- **Only official public APIs** for job boards and GitHub. X is linked, not ingested.
- **Wellfound automation acts on your own account.** It is dry run by default; live mode requires
  an explicit confirmation in the UI and in the API. Automated applying may break Wellfound's
  terms and can get an account rate-limited. You are responsible for how you use it; keep
  batches small.
- **Gmail is read-only** (`gmail.readonly`). Nothing is sent from your mailbox.

Future changes should keep these rules (see `CLAUDE.md`).

---

## Setup

Requirements: Node.js 20+, Docker (for Postgres, or the full stack), and Google Chrome on the host
if you want Wellfound auto-apply.

```bash
git clone --recurse-submodules <repo-url> job-agent
cd job-agent
cp .env.example .env        # then fill in the values you need (see below)
npm install                 # server + web workspaces
```

### Option A: Docker Compose (full stack)

```bash
docker compose up -d --build
```

| Service | Host port | Notes |
| --- | --- | --- |
| `postgres` | `5433` | Postgres 15; data in the `postgres_data` volume |
| `server` | `3001` | Runs `prisma db push` on start, then the API and scheduler. `TZ=Asia/Kolkata`. |
| `web` | `3000` | The dashboard |

The server container uses `WELLFOUND_EXECUTOR=agent`: Wellfound runs go to the host agent at
`http://host.docker.internal:3002` (see the Wellfound how-to). `logs/` and `diagnostics/` are
mounted read-only; the host agent writes them.

`NEXT_PUBLIC_API_URL` is baked into the web image at build time (default
`http://localhost:3001`); rebuild `web` if you change it.

### Option B: local development (Postgres in Docker, apps on the host)

```bash
docker compose up -d postgres            # Postgres on localhost:5433
ln -s ../.env server/.env                # so the Prisma CLI sees DATABASE_URL
(cd server && npx prisma db push)        # sync the schema (there are no migrations)
npx tsx server/src/seed.ts               # optional: creates an empty profile if none exists

npm run dev:server                       # API on :3001 (tsx watch)
npm run dev:web                          # dashboard on :3000
```

The server loads the root `.env` itself. On the host the server finds Chrome and spawns the
Wellfound runner directly, so no agent is needed.

---

## Environment variables

All variables live in the root `.env` (see `.env.example`). Everything is optional except
`DATABASE_URL`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | — | Postgres URL, e.g. `postgresql://postgres:postgres@localhost:5433/job_agent?schema=public`. Docker Compose builds its own from `POSTGRES_*`. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `postgres` / `postgres` / `job_agent` | Used by Docker Compose and `scripts/backup.sh`. |
| `PORT` | `3001` | API port. |
| `FRONTEND_URL` | `http://localhost:3000` | Where the Gmail OAuth callback redirects back to. |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | API base URL for the web app (build-time in Docker). |
| `GEMINI_KEY` | — | Enables Gemini for cover letters, screening answers, networking drafts, email triage, the briefing's "In short" line and Wellfound answers. Every feature has a template fallback without it. |
| `GEMINI_MODELS` | `gemini-flash-lite-latest,gemini-flash-latest` | Comma-separated model fallback list. |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` | — | Google OAuth Web client. `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` are accepted as legacy aliases. |
| `GMAIL_REDIRECT_URI` | `http://localhost:3001/api/gmail/oauth2callback` | Must match the client's authorized redirect URI. |
| `GMAIL_INITIAL_LOOKBACK_DAYS` | `60` | How far back the first sync looks. Later syncs are incremental. |
| `GMAIL_SYNC_MAX_MESSAGES` | `150` | Most messages processed per sync; the rest wait for the next run. |
| `GITHUB_TOKEN` | — | Optional personal access token (no scopes needed) to raise the GitHub API rate limit for people discovery. |
| `GMAIL_AUTO_SYNC` | `true` | Sync Gmail on each scheduler tick when connected. `false` means manual sync only. |
| `SYNC_INTERVAL_MINUTES` | `60` | Scheduler interval. Each tick runs the job sync, then liveness checks, the Wellfound CSV import and the Gmail sync. |
| `DISABLE_SCHEDULER` | `false` | `true` disables the scheduler entirely (job/Gmail sync, liveness, CSV import and the briefing trigger). |
| `WELLFOUND_EXECUTOR` | `auto` | `local` spawns the runner in the server process, `agent` proxies to the host agent, `auto` uses local when Chrome is found, else the agent if `WELLFOUND_AGENT_URL` is set. Docker Compose sets `agent`. |
| `WELLFOUND_AGENT_URL` | — (Compose: `http://host.docker.internal:3002`) | Host agent URL. |
| `WELLFOUND_AGENT_TOKEN` | — | Shared secret between server and agent. Required for `wellfound:agent:docker`. Generate with `openssl rand -hex 24`. |
| `WELLFOUND_AGENT_HOST` / `WELLFOUND_AGENT_PORT` | `127.0.0.1` / `3002` | Agent bind address (`--docker` forces `0.0.0.0`). |
| `CHROME_PATH` | auto-detected | Chrome binary for the runner. |
| `WELLFOUND_ROOT`, `WELLFOUND_LOGS_DIR`, `WELLFOUND_DIAGNOSTICS_DIR`, `WELLFOUND_APPLICATIONS_CSV`, `WELLFOUND_PROFILE_DIR`, `WELLFOUND_RUNNER_CONFIG`, `WELLFOUND_ENV_FILE` | repo paths | Path overrides; rarely needed. |
| `TZ` | `Asia/Kolkata` in Compose | All "today" logic uses IST helpers regardless, but set it for readable logs. |
| `TEST_DATABASE_URL` | derived | Overrides the test database (see Testing). |

`ENABLE_GMAIL_SEND=true` adds the `gmail.send` scope to the consent request, but no feature sends
mail; leave it unset.

---

## First-run checklist

1. **Profile & Resume tab:** upload your resume PDF (or paste it), check the parsed skills,
   education and graduation year, and set preferences (locations, remote, target role). Add more
   resumes if you target different roles.
2. **Job Discovery → Manage sources:** review the default sources and click **Sync** (or wait for
   the scheduler). Then filter by "Internships only" and sort by best match.
3. **Gmail tab:** connect Gmail (setup below) and run a sync. Turn on job alerts on LinkedIn,
   Naukri, Internshala and Wellfound so their emails feed Discovery.
4. **Wellfound tab:** install, log in, start the agent if you use Docker, fill in Profile & Rules,
   and do a dry run (below).
5. Check the **Daily Briefing** after 20:00 IST.

---

## Wellfound AutoApply how-to

Full reference: [scripts/wellfound/README.md](scripts/wellfound/README.md).

### 1. Install and log in (once)

1. Install Google Chrome (the runner uses your real Chrome; set `CHROME_PATH` if it is not at
   the default location).
2. `npm run wellfound:install` installs Playwright into the `wellfound_autoApply/` submodule.
3. `npm run wellfound:login` opens Chrome. Log in to Wellfound and close the window. The session
   is saved in `wellfound_autoApply/.wellfound-chrome-profile/` (git-ignored).
4. Fill in **Wellfound → Profile & Rules** and save. It is stored on your profile in the database
   and used for every run and for the Zen script.

### 2. Start the agent (Docker only)

If the server runs on the host (`npm run dev:server`), skip this. With Docker:

1. Add `WELLFOUND_AGENT_TOKEN=<random>` to `.env` (`openssl rand -hex 24`) and recreate the
   server: `docker compose up -d --build server`.
2. In a terminal **inside your desktop session** (so `DISPLAY` is set), run
   `npm run wellfound:agent:docker`. It listens on `0.0.0.0:3002` and refuses to start without the
   token. (`npm run wellfound:agent` binds to `127.0.0.1` only, which a container cannot reach.)
3. Check: `npm run wellfound:preflight`, or open the Run tab. Every required item should be green.

### 3. Dry run first

From the Run tab choose **Dry run**, a small batch, optionally **Visible**, and start. Or:

```bash
npm run wellfound:dry-run                                              # 3 jobs, off-screen
node scripts/wellfound/runner.js wellfound --dry-run --max=1 --visible # 1 job, watch it
```

A dry run fills the cover letter and questions and logs `DRY_RUN — would click: Apply`. It never
presses Apply and never writes to `applications.csv`.

### 4. Read the logs and diagnostics

- Logs stream live and remain in **History & Diagnostics** (`logs/wellfound/<runId>.log`). The
  last line is a `SUMMARY {...}` with submitted/skipped/errors.
- On failures, `diagnostics/wellfound/<runId>/` holds `NN-<reason>.png/.html/.json` (reasons
  include `logged-out`, `bot-check`, `no-apply-modal`, `no-submit-button`, `submit-disabled`,
  `page-crash`, `fatal`). The UI shows screenshot thumbnails; HTML files download as attachments.
- `--trace` (or the Trace option) adds `trace.zip`: `npx playwright show-trace diagnostics/wellfound/<runId>/trace.zip`.

### 5. Live mode

Choose **Live**, set the batch, and type `APPLY` to confirm. Live mode only picks
intern/fresher/entry-level engineering titles, skips senior/QA/design/native-mobile titles,
jobs older than 14 days and jobs already applied to, paces 1–5 minutes between applications, and
stops at `min(batch, dailyCap − today)` where "today" is counted in IST. Submissions are appended
to `applications.csv` and imported into the pipeline when the run ends.

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| Logged out / run exits with code 3 | Run `npm run wellfound:login`, log in or solve the check by hand, close the window. The `logged-out` screenshot is under History & Diagnostics. |
| "Chrome profile in use" | Close the Wellfound Chrome window (the login window or a previous run). |
| Preflight: host agent unreachable | Start `npm run wellfound:agent:docker`. The token must match `.env`, and the server container must be recreated after adding it. |
| Preflight: display not available | Start the agent from a terminal in your desktop session, not over SSH or as a system service. `DISPLAY`/`WAYLAND_DISPLAY` is taken from the environment. |
| "No more matching jobs" | The feed has no new matching titles; the log prints sample titles it saw. Try later. |
| `EACCES` writing `logs/` | Docker created the directory as root: `sudo chown -R $USER logs diagnostics`. |
| "Today" looks wrong | It is computed from `applications.csv` in IST. Check the dates in the Applied tab. |

---

## Gmail setup

1. In the [Google Cloud console](https://console.cloud.google.com/), create (or pick) a project.
2. **APIs & Services → Library:** enable the **Gmail API**.
3. **OAuth consent screen:** user type **External**; add your Gmail address under **Test users**;
   add the scopes `gmail.readonly`, `userinfo.email` and `userinfo.profile`.
4. **Credentials → Create credentials → OAuth client ID:** type **Web application**, authorized
   redirect URI `http://localhost:3001/api/gmail/oauth2callback`.
5. Put the client ID and secret in `.env` as `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` and restart
   the server (`docker compose up -d server` re-reads `.env`).
6. Open the **Gmail** tab → **Connect Gmail**, approve, and you land back on `?tab=GMAIL`. Click
   **Sync now**.

While the consent screen is in **Testing** status, Google expires refresh tokens after **7 days**.
The tab then shows **Expired**; click Connect again.

To track other inboxes (university mail, a second Gmail), forward their job-related mail
(LinkedIn notifications, ATS senders) to the connected Gmail with a filter rule instead of
connecting several accounts.

---

## Maintenance scripts and backups

Back up before running anything with `--apply`:

```bash
./scripts/backup.sh                       # pg_dump -F c into backups/, chmod 600, verified
# or by hand:
docker exec job_agent_db pg_dump -U postgres -F c job_agent > backups/job_agent_$(date +%Y%m%d_%H%M%S).dump
./scripts/restore.sh backups/<file>.dump  # asks for confirmation (--force when non-interactive)
```

Server scripts (`server/src/scripts/`, run from `server/`). All except the backfill are dry runs
unless you pass `--apply`:

| Command | What it does |
| --- | --- |
| `npx tsx src/scripts/cleanupFakeJobs.ts [--apply]` | Deletes fabricated listings from older versions (`wf-startup-*`, `li-mock-*`, old seed jobs). Listings with applications are kept and printed. Normalises legacy source names. |
| `npx tsx src/scripts/cleanupFakeContacts.ts [--apply]` | Deletes fabricated contacts (placeholder names, LinkedIn *search* URLs as profiles) and their messages; backfills `companyKey` and `linkedinUrl`. |
| `npx tsx src/scripts/cleanupDemoEmails.ts [--apply]` | Deletes demo/simulated email events and lists (does not revert) the stage/contact changes old demo events made. |
| `npx tsx src/scripts/migrateResumes.ts [--apply] [--no-rescore]` | Creates a default "General" resume from the legacy single resume, then rescores jobs. |
| `npx tsx src/scripts/backfillCompanyKeys.ts` | Fills `companyKey` and `isInternship` on old rows. Writes immediately; safe to re-run. |
| `npx tsx src/seed.ts` | Creates the candidate profile only if none exists. Never deletes data or creates jobs. |

Against the Docker database from the host, prefix with
`DATABASE_URL="postgresql://postgres:postgres@localhost:5433/job_agent?schema=public"`.

---

## Testing

Server tests delete rows from every table, so they never run against your dev database:
`server/vitest.global-setup.mts` derives a sibling `<db>_test` database from `DATABASE_URL`
(e.g. `job_agent_test`), creates it if missing, runs `prisma db push`, and refuses to run if the
database name does not contain `test`. Set `TEST_DATABASE_URL` to use a different one. Tests run
with `GEMINI_KEY` empty and the scheduler disabled; files run serially.

```bash
docker compose up -d postgres

npm run test:server                       # vitest, node, against job_agent_test
npm run test:web                          # vitest, jsdom + Testing Library
npm run build:server && npm run build:web
npm run lint -w web                       # web only; the server has no linter

# one file / one test name
npm run test -w server -- src/__tests__/applicationsPipeline.test.ts
npm run test -w server -- -t "never downgrades"
npm run test -w web -- src/components/Dashboard.test.tsx

# a separate test database
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5433/job_agent_test_other?schema=public" npm run test:server
```

---

## Project structure

```
server/
  prisma/schema.prisma        data model (db push, no migrations)
  src/api/                    Express routers, all under /api
  src/lib/                    company keys, stage rules, IST time, active profile, Gemini client
  src/connectors/             one module per job API; registry.ts has the defaults
  src/discovery/              job-alert email parser, search links, X feed list
  src/jobs/                   sync service, normalisation, liveness
  src/matching/               engine, skill vocabulary, per-resume scoring
  src/resumes/                PDF parsing, resume service, rescoring, tailoring
  src/applications/           pipeline read model, fit score, audit trail
  src/networking/             contacts, priority, people links, GitHub, message drafts
  src/email/                  Gmail OAuth/sync, classifier, effects, summary, demo
  src/briefing/               build, render, "In short", service
  src/wellfound/              run service (local/agent executors), config, diagnostics
  src/scheduler/cron.ts       background sync + 20:00 IST briefing trigger
  src/scripts/                maintenance scripts
web/src/components/           one component (and folder) per tab, colocated tests
scripts/wellfound/            runner, host agent, preflight, console-script build
scripts/backup.sh, restore.sh database backup/restore
wellfound_autoApply/          upstream Wellfound script (git submodule, unmodified)
job-auto-apply/               upstream multi-site auto-apply (git submodule, not used by the app)
docs/                         design notes, sources, security
```

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Server can't reach the database | Postgres listens on **5433** on the host, not 5432. In Docker the server uses `postgres:5432`. |
| Prisma "Environment variable not found: DATABASE_URL" | Create the `server/.env` symlink (`ln -s ../.env server/.env`) or export `DATABASE_URL`. |
| Discovery is empty | Upload a resume, then sync sources in Manage sources. Check "Active only" and other filters. |
| Gmail: `redirect_uri_mismatch` | The redirect URI in Google Cloud must equal `GMAIL_REDIRECT_URI` exactly. |
| Gmail: "access blocked" / not a test user | Add your address under OAuth consent screen → Test users. |
| Gmail shows Expired | Testing-mode refresh tokens last 7 days; reconnect. |
| Gmail sync finds nothing | The first sync only looks back `GMAIL_INITIAL_LOOKBACK_DAYS`, and only job-related senders/subjects are fetched. |
| Briefing missing tonight | It is generated at/after 20:00 IST while the server runs; it catches up on the next check. `DISABLE_SCHEDULER=true` turns it off. Use Regenerate in the tab. |
| Gemini text looks like a template | `GEMINI_KEY` is unset or every model in `GEMINI_MODELS` failed; see the server log. |
| GitHub people search rate-limited | Set `GITHUB_TOKEN`. |
| Server tests refuse to run | The test database name must contain `test`; check `TEST_DATABASE_URL`. |
| Wellfound problems | See the Wellfound troubleshooting table above. |

---

## Further documentation

- [CLAUDE.md](CLAUDE.md): commands, gotchas and architecture for contributors.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): components, data model and data flows.
- [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md): what is implemented, per area.
- [docs/SECURITY.md](docs/SECURITY.md): trust boundaries, secrets, compliance, backups.
- [docs/JOB_SOURCES.md](docs/JOB_SOURCES.md): job APIs and verified default sources.
- [docs/X_SOURCES.md](docs/X_SOURCES.md): researched X accounts.
- [docs/NETWORKING_PLAYBOOK.md](docs/NETWORKING_PLAYBOOK.md): referral outreach advice behind the drafts.
- [scripts/wellfound/README.md](scripts/wellfound/README.md): Wellfound runner reference.
- [docs/INTEGRATION_DECISIONS.md](docs/INTEGRATION_DECISIONS.md), [docs/OPEN_SOURCE_RESEARCH.md](docs/OPEN_SOURCE_RESEARCH.md), [docs/THIRD_PARTY_COMPONENTS.md](docs/THIRD_PARTY_COMPONENTS.md): background research and decisions.

## License

ISC
