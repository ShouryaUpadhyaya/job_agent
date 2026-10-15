# Open Source Job Automation Research

This document outlines the evaluation of several open-source repositories focused on automating job search, application, and resume parsing processes. The goal is to identify their current state, architecture, security implications, and to recommend reusable components for building a robust job application agent.

## Evaluated Repositories

### 1. `pulkit017/job-apply-mcp`
- **Focus:** Job application agent leveraging the Model Context Protocol (MCP).
- **Code & Dependencies:** Python, `mcp`, `playwright`.
- **Activity:** Last updated in August 2026.
- **License:** None specified.
- **Architecture & Setup:** Uses Playwright for browser automation, structured around an MCP server to interface directly with models like Claude.
- **Security Implications:** Configurations and API keys are stored locally. Usage of Playwright means normal local browser security applies. No explicit remote data transfer is observed.
- **Recommendation for Reuse:** The MCP interface layer could be useful if the architecture intends to make the agent callable directly from an MCP-compatible IDE or assistant.

### 2. `abhayiitbhu/jobs-auto-apply`
- **Focus:** Configuration-driven job application script.
- **Code & Dependencies:** Python, `playwright`, `pyyaml`, `click`. Uses `pyproject.toml`.
- **Activity:** Last updated in July 2026.
- **License:** None specified.
- **Architecture & Setup:** CLI-driven approach using Playwright. Configured via YAML (`config.example.yaml`) and supports external cookie files (e.g., `cookies.uplers.json`) for authentication.
- **Security Implications:** Requires saving and reusing session cookies locally. Risk of session hijacking if these files are exposed or if the agent is run in an untrusted cloud environment.
- **Recommendation for Reuse:** Cookie handling and session management patterns for sites that require manual login prior to automation.

### 3. `fahadNoufal/job-application-agent`
- **Focus:** Resilient, agentic job application tool using LangGraph.
- **Code & Dependencies:** Python, `langgraph`, `google-genai`, `playwright`, `aiosqlite`, `cryptography`.
- **Activity:** Last updated in March 2026.
- **License:** MIT License.
- **Architecture & Setup:** High robustness with features like crash-recovery, idempotent submissions (never re-applying to the same job), and human-like randomized browser timing. Uses SQLite for application tracking.
- **Security Implications:** Notably features **encrypted storage** using the `cryptography` library, ensuring that sensitive user data (like passwords or PII) is securely managed on disk.
- **Recommendation for Reuse:** The **LangGraph-based state machine**, crash-recovery logic, and encrypted SQLite storage are highly recommended for reuse.

### 4. `anton-karlovskiy/job-agent`
- **Focus:** Job application automation via generic browser-use models.
- **Code & Dependencies:** Python (uv), `browser-use`, `sqlalchemy`, `pypdf2`.
- **Activity:** Last updated in June 2026.
- **License:** None specified.
- **Architecture & Setup:** Utilizes the `browser-use` library which delegates HTML navigation entirely to the LLM (like Claude or `bu-ultra`), making it highly adaptable to changes in job board UI. Pauses for human intervention (CAPTCHA, MFA).
- **Security Implications:** Relies heavily on environment variables (`.env`). Browser sessions are interactive and can yield to human input.
- **Recommendation for Reuse:** The integration with the **`browser-use`** package. It significantly abstracts away the fragility of hard-coded Playwright locators.

### 5. `elbin0324/auto-apply`
- **Focus:** Full-stack SaaS platform for AI job applications.
- **Code & Dependencies:** Python backend (FastAPI, Supabase, Anthropic), React/TS frontend.
- **Activity:** Last updated in September 2026.
- **License:** Proprietary ("All rights reserved"). Not officially open source.
- **Architecture & Setup:** Complex distributed setup (Docker, Postgres/Supabase, Frontend/Backend split).
- **Security Implications:** Handles user data in a multi-tenant cloud environment with proper database security and auth.
- **Recommendation for Reuse:** **Cannot be reused** due to the restrictive copyright, but serves as a good architectural reference for scaling to a web app.

### 6. `AnshulDas007/Agentic-Job-Apply-Companion`
- **Focus:** A semi-autonomous agent prioritizing safety and fraud-prevention.
- **Code & Dependencies:** Python, `playwright`, `pydantic`.
- **Activity:** Last updated in October 2026.
- **License:** MIT License.
- **Architecture & Setup:** Features structured profile parsing (via Pydantic) and includes built-in safeguards like fraud filtering (detecting WhatsApp-only hiring, registration fees). Supports Greenhouse, Lever, Workday, and Ashby out of the box.
- **Security Implications:** "Never auto-signs anything legally binding." Explicit focus on keeping the human in control.
- **Recommendation for Reuse:** The **fraud-filtering module**, **Pydantic schemas for applicant profiles**, and specific scraper definitions for ATS platforms (Workday, Lever, etc.).

### 7. `sguan119/job-automation-toolkit`
- **Focus:** Workflow-oriented approach using n8n and Claude AI agents.
- **Code & Dependencies:** Node.js, `n8n-workflows`, `@vercel/agent-browser`.
- **Activity:** Last updated in March 2026.
- **License:** MIT License.
- **Architecture & Setup:** Completely different paradigm. Uses low-code workflow engine (n8n) combined with Node-based browser automation.
- **Security Implications:** Standard n8n security practices apply. Integrations require storing credentials in n8n's vault.
- **Recommendation for Reuse:** The **n8n workflow templates** could be adapted if providing a low-code UI to the user is desired.

---

## Additional Maintained Alternatives

During research, several other well-maintained community projects were identified that could provide valuable reference or components:

1. **[Pickle-Pixel/ApplyPilot](https://github.com/Pickle-Pixel/ApplyPilot)**: A fully autonomous AI agent handling form filling and document uploads.
2. **[AkbarDevop/ai-job-agent](https://github.com/AkbarDevop/ai-job-agent)**: Tailored for Claude Code, specific integrations for Greenhouse, Jobvite, Lever, and Ashby.
3. **[career-ops-hq/career-ops](https://github.com/career-ops-hq/career-ops)**: A local CLI agent that does CV-to-job matching, scoring, and cover letter generation.
4. **[hlan98/JobHunterCat](https://github.com/hlan98/JobHunterCat)**: Features multi-resume support, smart scoring, and Telegram integration for notifications.
5. **[adgramigna/job-board-scraper](https://github.com/adgramigna/job-board-scraper)**: Open-source multi-ATS scraper supporting Greenhouse, Lever, Ashby, and Rippling with normalized JSON outputs.
6. **[rishilahoti/ashby-job-scraper](https://github.com/rishilahoti/ashby-job-scraper)**: Production-grade scraper targeting Ashby's public API endpoints, persisting state into PostgreSQL.
7. **[xitanggg/open-resume](https://github.com/xitanggg/open-resume)**: Modern open-source TypeScript & Next.js resume parser and builder supporting structured client-side PDF parsing and validation.

---

### Layer 4: Gmail Integration, OAuth & Email Synchronization

| Candidate / Project | Tech / Interface | Strengths | Weaknesses | Engineering Recommendation |
|---|---|---|---|---|
| **Official `googleapis` Node.js SDK** (`google.gmail('v1')`) | TypeScript / Node.js | Official Google SDK, reliable OAuth2 token management, narrow scope control (`gmail.readonly`), zero third-party dependency risks | Low-level API requires building custom query batching and rate limiting | **ADOPT (Primary)**: Standardize on official `googleapis` OAuth2Client with AES-256 encrypted refresh tokens stored in PostgreSQL. |
| **`CareerSync`** | TypeScript / OAuth2 / Gmail | Automated classification (Applied, Interview, Rejected), query filter presets | Cloud-centric, monolithic schema | **ADAPT PATTERNS**: Reuse query filter strings (`subject:(application OR interview OR offer OR rejection OR assessment OR "accepted your invitation")`) and status mapping. |
| **`JustAJobApp`** | Python / Gmail API | Public curated filter lists for recruiter emails and ATS notification domains | Tightly coupled to external database | **ADAPT**: Port its whitelist of ATS sender domains (e.g. `greenhouse.io`, `lever.co`, `ashbyhq.com`, `messages-noreply@linkedin.com`, `wellfound.com`). |
| **Direct IMAP / App Passwords** | Node.js `imap` / `mailparser` | Bypasses Google OAuth verification hurdles | Insecure; requires user to create and paste Google App Passwords; lacks granular revocation | **REJECT**: Google strongly discourages App Passwords for third-party tools. Use standard OAuth 2.0 with PKCE and narrow scopes. |

### Layer 5: LinkedIn Networking & Referral CRM

| Candidate / Project | Tech / Interface | Strengths | Weaknesses | Engineering Recommendation |
|---|---|---|---|---|
| **`PingCRM` / `Twenty`** | TypeScript / React / GraphQL | Clean relationship state machine (`RESEARCHED`, `REQUEST_SENT`, `ACCEPTED`, `MESSAGE_SENT`), interaction timeline | Enterprise scale, excessive overhead for a local solo job agent | **ADAPT CRM SCHEMA**: Adapt their lightweight relational model (`NetworkingContact`, `NetworkingMessage`) and interaction stage progression. |
| **`Linki` / `LinkedIn-Automation`** | Python / Selenium / Chrome Extension | Automated connection requests and direct messaging | **High ban risk**: Violates LinkedIn User Agreement section 8.2; triggers CAPTCHAs, IP rate-limits, and account suspensions | **REJECT AUTOMATED DISPATCH**: Never automate outbound connection requests or DMs. Enforce user-assisted workflow: generate tailored drafts, provide 1-click copy, and provide direct `Open LinkedIn Profile` link. |
| **`LinkedIn MCP Server` / `Linked API`** | Model Context Protocol / Node.js | Structured tools for LLM agent interaction | Requires active session cookies or API keys | **ADOPT AS DATA FORMAT**: Model our contact research and message draft interfaces to match standard MCP tool contracts for future agent extensibility. |
| **Gmail-Based Connection Detection** | Gmail API parsing | 100% legal, non-invasive detection of accepted LinkedIn connections via official notification emails (`messages-noreply@linkedin.com`) | Only catches acceptances when email notifications are enabled by the user | **ADOPT (Primary Automated Source)**: Ingest LinkedIn acceptance emails via Gmail to automatically advance contact status to `ACCEPTED` and trigger follow-up drafting. |

### Layer 6: Wellfound Job Discovery & Application Assistance

| Candidate / Project | Tech / Interface | Strengths | Weaknesses | Engineering Recommendation |
|---|---|---|---|---|
| **Wellfound Official Search & Public Pages** | HTTP / Browser | Publicly accessible startup listings, high accuracy on early-stage and seed/Series A equity roles | No public candidate write API | **ADOPT USER-ASSISTED WORKFLOW**: Ingest structured listing metadata, check eligibility against candidate profile, prepare application checklist, and execute clean browser handoff for human submission. *(Later superseded: the app now drives the user's own Chrome session with a Playwright runner, dry run by default; there is no Wellfound listing feed.)* |
| **`wellfound_graphqlscout` / Unofficial GraphQL** | Reverse-engineered GraphQL | Extracts deep company and compensation data | Fragile; subject to breaking changes and Cloudflare anti-bot blocks | **USE AS FALLBACK / STUDY**: Leverage its GraphQL payload structures as reference for field mapping without violating platform terms. |
| **Apify Wellfound Actor** | Cloud Scraping Actor | Managed proxy rotation, anti-bot bypass | Paid SaaS subscription; violates self-hosted offline principles | **REJECT**: Keep system self-contained on local machine without subscription dependencies. |

### Layer 7: Daily Job-Search Summary & Briefing Engine

| Candidate / Project | Tech / Interface | Strengths | Weaknesses | Engineering Recommendation |
|---|---|---|---|---|
| **Cron-driven Digest (`cron` / `node-cron`)** | Node.js timers | Scheduled generation at specific local time (8:00 PM IST / 14:30 UTC), low memory footprint | Node process timer can miss runs if offline | **ADOPT HYBRID**: In-process scheduler checking last run date in database, recovering missed runs upon server startup. |
| **`JobHunterCat` / Daily Bot Digest** | Python / Telegram | Formats daily activity into high-signal action items ("Needs Attention" vs "No Action Needed") | Tied to Telegram bot | **ADAPT DIGEST TEMPLATE**: Port its Markdown digest structure into our Dashboard and optional self-directed Gmail digest. |

---

## Final Integrated Architecture Plan

> **Status note (Phase 8).** This was the plan at research time. What was built differs: Gmail
> tokens are stored unencrypted in the local database (no AES encryption), the classifier has 12
> classes, LinkedIn postings are never fetched (they come only from alert emails, search links
> and pasted details), and Wellfound applying is automated on the user's own account (dry run by
> default). See `README.md` and `SECURITY.md` for the current design.

Based on the multi-layer research:
1. **Gmail Subsystem**: Official Google OAuth 2.0 flow (`googleapis`), narrow read-only scope (`gmail.readonly`), AES-256 encrypted refresh tokens, incremental message synchronization, and 13-category rule-based email classifier with confidence metrics.
2. **LinkedIn Networking Subsystem**: Relational CRM (`NetworkingContact`, `NetworkingMessage`) tracking the full connection lifecycle. Automatic transition to `ACCEPTED` upon parsing Gmail connection notifications. Automated drafting of concise ($\le 300$ char) connection notes and tailored referral follow-ups with explicit user review and zero automated spamming.
3. **Wellfound & LinkedIn Workflows**: Normalization of startup and LinkedIn postings into unified `JobListing` pipeline. Multi-stage application preparation with eligibility evaluation and assisted browser handoff.
4. **Daily Briefing**: Scheduled job generating an 8:00 PM IST digest combining Gmail events, application updates, and networking tasks into a prioritized dashboard view.


