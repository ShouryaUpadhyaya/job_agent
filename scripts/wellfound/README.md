# Wellfound auto-apply

Applies to intern / fresher engineering roles on wellfound.com from your own Chrome session.
The upstream console script in `wellfound_autoApply/` (git submodule, kept unmodified) is patched
in memory by `build-wellfound-paste.js` and driven by `runner.js` with Playwright.

| File | What it does |
| --- | --- |
| `runner.js` | Playwright runner: opens Chrome with the saved session, injects the patched script, logs, diagnostics, CSV |
| `agent.js` | Host agent (HTTP, `127.0.0.1:3002`): starts/stops the runner for the API server, mainly when the server runs in Docker |
| `preflight.js` | Environment checklist (Playwright, Chrome, DISPLAY, saved session, build, CSV) with fix commands |
| `build-wellfound-paste.js` | Builds the console script; dry run unless `--live`; `out/wellfound-zen.js` is the paste-in-console bundle |
| `human-layer.js` | Human-like timing, typing, mouse movement and Gemini calls, spliced into the console script |
| `lib.js` | Shared helpers (IST dates, CSV, DRY_RUN injection, config) |
| `profile-defaults.json` | Resume facts used when the database profile leaves a field empty |

## Setup (once)

1. Install Google Chrome. The runner uses your real Chrome (`/opt/google/chrome/chrome`, or set `CHROME_PATH`).
2. `npm run wellfound:install` installs Playwright into `wellfound_autoApply/node_modules`.
3. `npm run wellfound:login` opens Chrome. Log in to Wellfound, then close the window. The session is saved in
   `wellfound_autoApply/.wellfound-chrome-profile/` (git-ignored).
4. Fill in **Wellfound → Profile & Rules** in the dashboard and save. It is stored on your candidate profile in the
   database. That profile is the source of truth for every run and for the Zen script.
5. Start the agent (see below), then run `npm run wellfound:preflight` or open the Run tab. Every item should be green.

## Running it from the dashboard

How the runner is reached depends on where the server runs:

- **Server on the host** (`npm run dev:server`). The server finds Chrome and spawns `runner.js` itself. You need no agent.
- **Server in Docker** (`docker compose up`). The container has no Chrome and no display, so it proxies to the host agent:
  1. Add a random token to the root `.env`, for example `WELLFOUND_AGENT_TOKEN=$(openssl rand -hex 24)`.
     docker-compose passes it to the server.
  2. Recreate the server: `docker compose up -d --build server`.
  3. In a terminal inside your desktop session (so `DISPLAY` is set), run `npm run wellfound:agent:docker`.
     It listens on `0.0.0.0:3002` and refuses to start without the token. The container reaches it at
     `http://host.docker.internal:3002`.

  `npm run wellfound:agent` binds to `127.0.0.1` only. That is the safe default, but a container can't reach it.

The server stores every run as a `WellfoundRun` row:

- The log goes to `logs/wellfound/<runId>.log`. The agent or server writes it, and it is append-only.
- The UI streams the log over SSE: `GET /api/wellfound/runs/:id/stream`. The fallback is `GET /api/wellfound/runs/:id/log?offset=N`.
- Diagnostics go to `diagnostics/wellfound/<runId>/`.

Both directories are git-ignored and are mounted read-only into the server container.

## Dry run first

```bash
npm run wellfound:dry-run                                              # 3 jobs, off-screen
node scripts/wellfound/runner.js wellfound --dry-run --max=1 --visible # 1 job, watch it
```

A dry run opens matching jobs, fills the cover letter and questions, and logs `DRY_RUN — would click: Apply`.
It never presses Apply and never writes to `applications.csv`. `DRY_RUN` is set explicitly in both directions on
every build. The build refuses to produce a script without the flag, so a stale file can't turn a dry run into a
live one.

## What live mode does

`--live`, or Live in the dashboard (where you must type `APPLY` to confirm):

- It picks only intern, fresher and entry-level engineering titles. It skips senior, lead, QA, design and native-mobile
  titles, jobs older than 14 days, and jobs already in `applications.csv` (the list is re-read before every injection
  and after every submission).
- It writes a cover letter and answers. Gemini writes them when `GEMINI_KEY` is set; Node calls Gemini through a
  Playwright binding, so the key is never injected into the page. Without the key, it uses templates built from your
  highlights.
- It paces itself like a person: 1–5 minutes between applications, plus longer breaks.
- It stops at `min(batch, dailyCap - today)`. "Today" counts the CSV rows dated on the current IST calendar day. The
  CSV now stores ISO timestamps; legacy `M/D/YYYY, h:mm AM` rows are read as IST.
- Each submission is appended to `applications.csv`. When a live run ends, the CSV is synced into the Applications
  pipeline. The sync is idempotent and forward-only: it never moves an application backwards and creates no contacts.

Automated applying may break Wellfound's terms and can get an account rate-limited. Keep batches small.

## Runner reference

```
node scripts/wellfound/runner.js wellfound [login] [--dry-run|--live] [--max=N] [--visible] [--trace]
       [--run-id=ID] [--log-file=PATH] [--diagnostics-dir=DIR] [--config=FILE] [--daily-cap=N]
       [--profile-dir=DIR] [--max-minutes=N] [--preflight]
```

- **Log line format:** `<ISO+05:30> <LEVEL> <message>`, with levels INFO, WARN, ERROR, PAGE, PAGEERR, DIAG and SUMMARY.
- **Last line:** `SUMMARY {"status":…,"submitted":…,"skipped":…,"errors":…}`.

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Failure |
| 2 | Environment or config problem (no Chrome, no DISPLAY, Playwright missing) |
| 3 | Logged out, or a bot check is showing |
| 130 | Stopped |

Diagnostics are saved as `NN-<reason>.png/.html/.json` for these reasons:

- `logged-out` / `bot-check`
- `no-apply-modal`
- `no-submit-button`
- `submit-disabled`
- `script-error`
- `page-crash`
- `fatal`
- `navigation-failed`

`--trace` adds `trace.zip`. Open it with `npx playwright show-trace diagnostics/wellfound/<runId>/trace.zip`.

## Zen / console bundle

Run `npm run wellfound:zen`, or `npm run wellfound:zen:live` for a live bundle. Either writes
`scripts/wellfound/out/wellfound-zen.js`. Paste it into the DevTools console on wellfound.com/jobs.

The Gemini key is embedded only with `--with-key`. In the dashboard, the matching option is the "Embed my Gemini key"
checkbox (`GET /api/wellfound/script?includeKey=1`).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Preflight: *Host agent reachable* ✕ | Start `npm run wellfound:agent:docker`. The token must match in `.env`, and the server container must be restarted after adding it. |
| Preflight: *Display available* ✕ | Start the agent from a terminal in your desktop session, not over SSH or as a system service. |
| Run fails with exit 3 | Run `npm run wellfound:login`, then log in or solve the check by hand. Look at the `logged-out` screenshot under History & Diagnostics. |
| *Chrome profile in use* | Close the Wellfound Chrome window (the login window or a previous run). |
| Runs end with "No more matching jobs" | The feed has no new matching titles. The log prints sample titles it saw. Try later. |
| `EACCES` writing `logs/` | Docker created the directory as root. Run `sudo chown -R $USER logs diagnostics`. |
| "Today" looks wrong | It is computed from `applications.csv` in IST. Check the dates in the Applied tab. |
