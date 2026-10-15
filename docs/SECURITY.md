# Security, Privacy and Compliance

Job Agent is a single-user tool that runs on the user's own machine. It holds personal data
(resumes, contact details, Gmail-derived events, a logged-in Wellfound browser profile) and
talks to third-party sites. This document covers the trust boundaries, how secrets are handled,
the compliance rules the code follows, and backups.

---

## 1. Threat model and trust boundaries

- **No authentication.** The API has no login and uses permissive CORS (`cors()` with defaults).
  It must only be reachable from the user's machine. Do not expose ports 3000/3001 to a network.
  Because CORS is open, a web page open in the same browser can read API responses from
  `localhost:3001`; restricting CORS to `FRONTEND_URL` is a recommended hardening step.
- **Untrusted input:** job descriptions from APIs and RSS/JSON feeds, email bodies, pasted text,
  GitHub profile fields, and HTML captured from Wellfound pages. They are stored and displayed as
  data, never executed.
- **Database access** goes through Prisma with parameterised queries. Sort and filter parameters
  are validated against allowlists (`api/jobs.ts`, `applications/service.ts`,
  `networking/contacts.ts`).

## 2. Compliance rules (enforced in code)

- **No LinkedIn or Naukri automation.** There is no scraper, guest API call, server-side URL
  fetch or automated message for these sites. `connectors/utils.ts` `isRestrictedHost` rejects
  RSS/JSON sources pointing at them and keeps the liveness checker from fetching them.
  `POST /api/jobs/scrape/linkedin` returns 410. LinkedIn/Naukri jobs arrive only through their
  job-alert emails (parsed locally), search links the user opens, or pasted details. Legacy
  `linkedin`/`wellfound` source rows are disabled and cannot be re-enabled.
- **Official APIs only** for job boards (Greenhouse, Lever, Ashby, SmartRecruiters, Workable,
  Remotive, Remote OK, Arbeitnow) and GitHub. Remotive and Remote OK attribution and polling
  limits are honoured (`docs/JOB_SOURCES.md`). X accounts are links only.
- **No fabricated data.** No sample jobs, generated leads or placeholder contacts. Contact emails
  come only from Gmail senders, user input, or an address the person published on GitHub; email
  patterns are never guessed. Demo email events are created only by an explicit action, flagged
  `isDemo`, excluded from every list and summary, and never change applications or contacts.
- **Wellfound automation** acts on the user's own account through their own Chrome session.
  It is dry run by default; see section 4. Automated applying may break Wellfound's terms; the
  user is responsible for using it, and should keep batches small.
- **Outreach is never sent automatically.** Networking drafts are copied and sent by the user.
  Gmail access is read-only.

## 3. Secrets and personal data

| Item | Where it lives | Protection |
| --- | --- | --- |
| `.env` (DB password, `GEMINI_KEY`, Gmail client secret, `GITHUB_TOKEN`, `WELLFOUND_AGENT_TOKEN`) | Root `.env` | Git-ignored. Only `.env.example` (no values) is committed. |
| Gemini key | `.env`; optionally written there by `PUT /api/wellfound/config` | Sent to Google in the `x-goog-api-key` header, never in a URL. `GET /api/wellfound/config` returns only `geminiConfigured`. The Wellfound runner calls Gemini from Node through a Playwright binding, so the key is not injected into the page. The Zen console bundle embeds it only when the user ticks "Embed my Gemini key" (`GET /api/wellfound/script?includeKey=1`); generated bundles go to the git-ignored `scripts/wellfound/out/`. |
| Gmail OAuth tokens | `ConnectedAccount.accessToken` / `refreshToken` in Postgres | Stored **unencrypted** in the local database; protect the DB and its backups. Refreshed tokens are written back; disconnect revokes the token at Google and clears both columns. Auth failures mark the account `EXPIRED`. |
| Wellfound session | `wellfound_autoApply/.wellfound-chrome-profile/`, `apply-state-wellfound.json` | Git-ignored. Anyone with these files can act as the user on Wellfound. |
| Run logs and diagnostics | `logs/wellfound/`, `diagnostics/wellfound/` | Git-ignored; contain screenshots and HTML of the user's account. Mounted read-only into the server container. |
| Resumes, profile, contacts, emails | Postgres | Local only; uploaded PDFs are not committed (`*.pdf` ignored). Backups are `chmod 600`. |

Never paste real tokens, phone numbers or email addresses into docs, tests or fixtures.

### Gmail OAuth

- Scopes: `gmail.readonly`, `userinfo.email`, `userinfo.profile`. `gmail.send` is requested only
  if `ENABLE_GMAIL_SEND=true`, and no feature uses it.
- `state`: `email/oauthState.ts` issues a random 24-byte value per Connect click, held in memory,
  single-use, 10-minute expiry. The callback rejects missing, unknown or expired states.
- The callback only redirects to `FRONTEND_URL/?tab=GMAIL&auth=…`; error text is truncated.
- If the returned token lacks `gmail.readonly`, the connection is refused.

## 4. Wellfound automation safety

- **Dry run by default.** `build-wellfound-paste.js` always writes `DRY_RUN` explicitly and
  refuses to build without the flag. `GET /api/wellfound/script` builds live only with
  `?mode=live`; `PUT /api/wellfound/config` never builds a live script.
- **Live confirmation.** The UI requires typing `APPLY`; `runService.startRun` rejects a `LIVE`
  run unless the request carries `confirmLive: true`. Runs are capped at
  `min(batch, dailyCap − today)` with today counted in IST.
- **Host agent.** `scripts/wellfound/agent.js` binds to `127.0.0.1` by default. The Docker mode
  (`--docker`, binds `0.0.0.0`) refuses to start without `WELLFOUND_AGENT_TOKEN`; requests must
  send it in `x-agent-token` (or `Authorization: Bearer`), compared in constant time. Run IDs are
  validated before being used in paths.
- **Diagnostics serving.** `GET /api/wellfound/runs/:id/diagnostics/:file` only serves files
  inside that run's directory (name allowlist, no `..`, resolved-path check) with
  `X-Content-Type-Options: nosniff`. Captured HTML is third-party content, so it is served with
  `Content-Security-Policy: sandbox` and `Content-Disposition: attachment` and never rendered on
  the app's origin. Traces are served as attachments.
- Stage updates from the runner's CSV are forward-only (`lib/stages.ts`), so automation cannot
  undo a rejection or offer.

## 5. Prompt injection

Job descriptions, emails and pasted text reach Gemini. Mitigations:

- `lib/gemini.ts` callers wrap untrusted text in delimiters and instruct the model to treat it as
  data.
- Model output is only ever text shown to the user (drafts, summaries) or, for email triage,
  strict JSON whose classification must be one of the known classes; anything else falls back to
  the rule-based result. The model has no tools, no database writes and cannot start runs.
- Every AI feature has a deterministic fallback, and tests run with `GEMINI_KEY` empty.

## 6. Human approval and audit

- `POST /api/applications/:id/submit` returns 403 unless the application has `isApproved: true`,
  then marks it APPLIED and writes an audit entry. (The "Approve and Submit" button in the job
  detail copilot does not call this endpoint; it only changes local UI state.)
- `applications/audit.ts` records every application creation and stage change (manual, Gmail,
  Wellfound) in `AuditLog` with the source and previous stage.

## 7. Data cleanup

Scripts in `server/src/scripts/` remove fabricated jobs, contacts and demo emails left by older
versions. They are dry runs unless given `--apply`; take a backup first (section 8).

---

## 8. Database Backup and Restoration Procedures

The system utilizes automated bash scripts in `scripts/` targeting the PostgreSQL Docker container (`job_agent_db`). Backups use PostgreSQL's custom archive format (`pg_dump -F c`), providing compression, integrity checking, and granular object recovery.

### 8.1. Backup Procedure (`scripts/backup.sh`)

#### Workflow & Security Controls:
1. **Environment Auto-Detection:** Automatically loads credentials from `.env` or environment variables (`POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`, `POSTGRES_CONTAINER`).
2. **Health Verification:** Verifies Docker daemon status and PostgreSQL service readiness via `pg_isready` before execution.
3. **Atomic File Creation:** Dumps data to a temporary file (`.tmp.<PID>`) and registers exit/interrupt traps. The file is only moved to its destination after successful dump and validation.
4. **Owner-Only Permissions:** Applies `chmod 600` to the backup file to prevent unauthorized system users from reading candidate resumes and database records.
5. **Archive Integrity Validation:** Automatically verifies the dump file by testing TOC entries with `pg_restore --list`. If the archive is corrupt or truncated, the backup is aborted and the temporary file cleaned.
6. **Integrity Checksums:** Outputs SHA256 checksum and file size upon completion for audit logging and verification.
7. **Retention Management:** Optionally purges backups older than a configurable number of days when `BACKUP_RETENTION_DAYS` is set.

#### Usage:
```bash
# Standard backup to default directory (backups/job_agent_<db>_<timestamp>.dump)
./scripts/backup.sh

# Specify custom backup directory
./scripts/backup.sh --dir /secure/backup/storage

# Specify explicit output file path
./scripts/backup.sh /secure/backup/storage/daily_backup.dump

# View options and parameters
./scripts/backup.sh --help
```

### 8.2. Restoration Procedure (`scripts/restore.sh`)

#### Workflow & Safety Controls:
1. **Pre-Restoration Validation:** Before modifying the database, `restore.sh` validates that the input file exists, is readable, and represents a valid custom PostgreSQL dump archive via `pg_restore --list`.
2. **Destructive Action Confirmation:**
   - In interactive terminal sessions, the script warns the user and requires explicit confirmation (`[y/N]`) before restoring.
   - In non-interactive environments (e.g. CI/CD or automation scripts), the script requires the `--force` (`-f`) flag to prevent accidental data overwrites.
3. **Clean Restoration:** Uses `pg_restore` with `--clean --if-exists --no-owner --no-privileges` to cleanly drop and recreate existing database objects without ownership conflict errors.
4. **Post-Restoration Table Verification:** Runs an automated SQL query inspecting `information_schema.tables` and outputs the restored table list to verify database consistency.

#### Usage:
```bash
# Interactive restore (will prompt for confirmation)
./scripts/restore.sh backups/job_agent_job_agent_20261010_104108.dump

# Non-interactive / Force restore
./scripts/restore.sh --force backups/job_agent_job_agent_20261010_104108.dump

# Restore into alternative container or database
./scripts/restore.sh --container staging_db --database job_agent_staging backups/backup.dump

# View options and parameters
./scripts/restore.sh --help
```

---

## 9. Operational Hardening & Disaster Recovery

### 9.1. Automated Backup Scheduling (Cron)
For automated daily backups with retention management, configure a cron job on the host:

```bash
# Run backup daily at 02:00 AM, retaining backups for 30 days
0 2 * * * cd /path/to/job-agent && BACKUP_RETENTION_DAYS=30 ./scripts/backup.sh >> /var/log/job-agent-backup.log 2>&1
```

### 9.2. Offsite Replication & Encryption
- In production environments, database dump archives should be encrypted at rest using GPG:
  ```bash
  gpg --symmetric --cipher-algo AES256 backups/backup_job_agent_*.dump
  ```
- Encrypted archives should be synced to an offsite S3 or cold-storage bucket using server-side encryption (SSE-KMS) and Object Lock (WORM) to safeguard against ransomware.

### 9.3. Network & Secrets Isolation
- **Port exposure:** `docker-compose.yml` publishes `5433`, `3001` and `3000` on all host interfaces. Block them with a host firewall (`ufw`/`iptables`) or change the mappings to `127.0.0.1:<port>:<port>` if the machine is on an untrusted network.
- **Secret Management:** Never commit `.env` or production credentials to source control. Use environment variable secret injectors (e.g. Docker Secrets, HashiCorp Vault, or AWS Secrets Manager) in production.
