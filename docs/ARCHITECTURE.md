# Architecture

## Tech Stack
- **Frontend**: Next.js, React, TailwindCSS (unless vanilla CSS requested, falling back to standard UI libs), TypeScript
- **Backend**: Node.js, Express, TypeScript
- **Database**: PostgreSQL (relational structure for jobs, applications, logs)
- **ORM**: Prisma (type-safe database access)
- **Background Jobs**: Node.js built-in timers or lightweight Redis queue if necessary
- **Browser Automation**: Playwright (user-assisted only)

## Directory Structure
- `/server`: The Express backend containing APIs, Connectors, and Matching logic.
- `/web`: The Next.js frontend.
- `/docs`: Technical documentation and task tracking.
- `/docker-compose.yml`: Local infrastructure (PostgreSQL).

## Data Models (Initial Draft)
- **JobListing**: id, externalId, source, title, company, url, description, status, score, timestamp
- **CandidateProfile**: id, version, skills, location, preferences, resumeText
- **Application**: id, jobId, status, appliedAt, notes, resumeUsed

*(To be expanded as development begins)*
