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

---

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
| `multer` | `^1.4.5-lts.1` | Multipart file upload handling | MIT |

