# Adopted Third-Party Components & Open-Source Tracking

This document maintains an accurate record of external open-source projects, APIs, packages, schemas, and design patterns adopted or adapted into the **Job-Agent** codebase.

---

## 1. Adopted APIs & Connectors

### 1.1 Greenhouse Official Job Board API
- **Origin / Source:** Greenhouse Software Public API (`https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true`)
- **License / Terms:** Permitted public career feed access for indexing job opportunities.
- **Implementation in Code:** `server/src/connectors/greenhouse.ts`
- **Modifications / Enhancements:**
  - Added `fetchWithRetry` supporting exponential backoff (3 attempts) on HTTP 429 and 5xx errors.
  - Added HTML sanitization via `cleanHtml` to strip DOM tags and decode entities.
  - Added URL canonicalization (`canonicalizeUrl`) stripping tracking tokens (`gh_jid`, `gh_src`, UTM parameters).
- **Known Limitations:**
  - Requires valid board token (e.g., `cloudflare`, `github`, `canonical`).
  - Some custom metadata fields vary per organization.

### 1.2 Ashby Official Job Board API
- **Origin / Source:** Ashby HQ Public API (`https://api.ashbyhq.com/posting-api/job-board/{organization}`)
- **License / Terms:** Permitted public career feed access.
- **Implementation in Code:** `server/src/connectors/ashby.ts`
- **Modifications / Enhancements:**
  - Standardized JSON mapping to `RawJobPayload`.
  - Added automated fallback for location (extracts remote flag vs. office location).
  - Bounded request timeouts with `AbortController` (10s threshold).
- **Known Limitations:**
  - Rate limits apply if bombarded; mitigated via our central scheduler interval.

### 1.3 Arbeitnow Job Board API
- **Origin / Source:** Arbeitnow Public API (`https://www.arbeitnow.com/api/job-board-api`)
- **License / Terms:** CC BY 4.0 / Permitted for job search and discovery applications.
- **Implementation in Code:** `server/src/connectors/arbeitnow.ts`
- **Modifications / Enhancements:**
  - Converts unix timestamps to standard JavaScript Date objects.
  - Normalizes slug-based job URLs.
- **Known Limitations:**
  - European and remote-focused; requires filtering for India/Remote suitability.

### 1.4 Lever Official Job Board API
- **Origin / Source:** Lever Public API (`https://api.lever.co/v0/postings/{company}?mode=json`)
- **License / Terms:** Permitted public career feed access for indexing job opportunities.
- **Implementation in Code:** `server/src/connectors/lever.ts`
- **Modifications / Enhancements:**
  - Extracts title, location (including multi-location arrays), departments, and plain-text descriptions.
  - Implements `cleanHtml` and canonicalization for application URLs.
  - Integrated into `JobSourceConfig` dynamic management.

---

## 2. Architectural Patterns & Schema Standards

### 2.1 JSON Resume Schema Standard
- **Origin / Source:** [jsonresume.org](https://jsonresume.org/schema/) (Open source JSON Schema standard)
- **License:** MIT License
- **Implementation in Code:** `server/prisma/schema.prisma` (`CandidateProfile` model)
- **Modifications / Enhancements:**
  - Modeled relational entities in PostgreSQL with Prisma ORM.
  - Stores education, experience, and projects in structured JSON columns with validated schemas.

### 2.2 Open-Source Resume Parsing & Section Extraction
- **Inspiration:** `xitanggg/open-resume` (MIT) & `jsonresume.org`
- **Implementation in Code:** `server/src/resumes/parser.ts`
- **Modifications / Enhancements:**
  - Extracts plain text from PDF buffers via `pdf-parse`.
  - Heuristic taxonomy matching across 40+ engineering skills, graduation cohort (2028), education, and project bullet points.
  - Automatically triggers database job re-scoring on resume upload.

### 2.3 ATS Resume & Cover Letter Tailoring Engine
- **Inspiration:** `career-ops-hq/career-ops` (MIT)
- **Implementation in Code:** `server/src/resumes/tailor.ts`
- **Modifications / Enhancements:**
  - Computes direct ATS skill matches vs missing keywords from target job description.
  - Synthesizes grounded impact bullets and personalized cover letters without hallucination.
  - Generates versioned `Document` records in PostgreSQL.

### 2.4 Idempotency & Deduplication Engine
- **Inspiration:** `fahadNoufal/job-application-agent` (MIT) & `adgramigna/job-board-scraper` (MIT)
- **Implementation in Code:** `server/src/jobs/normalization.ts`
- **Modifications / Enhancements:**
  - Enforces compound unique database index `@@unique([externalId, source])` in Prisma.
  - Re-syncing the same job updates timestamps and score without creating duplicate records.

### 2.5 Strict Human-in-the-Loop (HITL) Gate
- **Inspiration:** `AnshulDas007/Agentic-Job-Apply-Companion` (MIT)
- **Implementation in Code:** `server/src/api/applications.ts` (`POST /api/applications/:id/submit`)
- **Modifications / Enhancements:**
  - Hardcoded HTTP 403 Forbidden rejection if `isApproved !== true`.
  - Guarantees automated agents cannot unilaterally submit job applications.

### 2.6 Gmail Inbound Synchronization & Multi-Class Email Classification
- **Origin / Source:** Google Gmail API v1 & OAuth 2.0 (`https://developers.google.com/gmail/api`)
- **License / Terms:** Google APIs Terms of Service; read-only scope `https://www.googleapis.com/auth/gmail.readonly`.
- **Implementation in Code:** `server/src/email/service.ts`, `server/src/email/classifier.ts`, `server/src/api/gmail.ts`
- **Modifications / Enhancements:**
  - OAuth2 flow with a single-use `state`, storing tokens (unencrypted) in the `ConnectedAccount` table.
  - 12-class rule-based classifier (ATS-aware) recognizing confirmations, assessments, interview invitations, offers, rejections, recruiter outreach, referral responses, LinkedIn connection acceptances and job alerts, with optional Gemini refinement.
  - Correlates events with `JobApplication` (forward-only stage changes) and `NetworkingContact`; job alerts become listings.

### 2.7 Wellfound & LinkedIn Normalizers and Application Checklists
- **Origin / Source:** Job details the user pastes (no request is made to LinkedIn or Wellfound)
- **Implementation in Code:** `server/src/connectors/wellfound.ts`, `server/src/connectors/linkedin.ts`
- **Modifications / Enhancements:**
  - Extracts numeric job IDs from pasted URLs and sanitizes pasted descriptions.
  - Distinguishes Easy Apply vs External ATS portals.
  - Generates pre-application checklist for candidates prior to official browser handoff.

---

### 2.8 Wellfound Auto-Apply Script (git submodule)
- **Origin / Source:** `https://github.com/ankitbaghel01/wellfound_autoApply` (submodule `wellfound_autoApply/`, kept unmodified; check the upstream repository for its license)
- **Implementation in Code:** `scripts/wellfound/build-wellfound-paste.js` patches the console script in memory; `scripts/wellfound/runner.js` drives it with Playwright in the user's Chrome; `scripts/wellfound/agent.js` runs it on the host for a containerised server.
- **Modifications / Enhancements:** explicit `DRY_RUN` injection, IST daily cap, scoped selectors, per-run logs and diagnostics, profile-driven config. Playwright is installed into the submodule (`npm run wellfound:install`).

### 2.9 Multi-site Auto-Apply (git submodule, not used by the app)
- **Origin / Source:** `https://github.com/Anshul439/job-auto-apply` (submodule `job-auto-apply/`). Only reachable through the root `job-apply:*` npm scripts; the server and dashboard do not use it.

## 3. Libraries & Dependencies

| Package | Version | Purpose | License |
|---|---|---|---|
| `express` | `^5.3.0` | REST API server | MIT |
| `@prisma/client` | `5.22.0` | Type-safe PostgreSQL ORM | Apache-2.0 |
| `vitest` | `^5.0.3` | Test runner & assertion library | MIT |
| `next` | `16.4.0` | React web framework | MIT |
| `react` | `19.3.0` | UI rendering | MIT |
| `tailwindcss` | `^4` | Utility-first styling | MIT |
| `rss-parser` | `^3.13.0` | RSS/Atom feed parsing | MIT |
| `pdf-parse` | `^2.4.5` | PDF text extraction | MIT |
| `multer` | `^2.4.0` | Multipart file upload handling | MIT |
| `googleapis` | `^185.0.0` | Official Google APIs client (Gmail, OAuth2) | Apache-2.0 |
| `google-auth-library` | `^11.2.0` | Google authentication & token management | Apache-2.0 |

