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

---

## Recommendations for the Final Architecture

Based on the evaluation, building a robust job application agent should combine the best open-source components from the MIT-licensed/permissive repositories above:

1. **Core Navigation Engine:** Use `browser-use` (as seen in `job-agent`) to handle fragile UI interactions, rather than hard-coding Playwright locators. This makes the agent resilient to UI updates on job boards.
2. **State & Workflow Management:** Adopt a `LangGraph` approach (from `job-application-agent`) to handle state transitions, retries, and crash-recovery (idempotency).
3. **Data Schema & Fraud Prevention:** Utilize the Pydantic-based schemas and fraud detection rules from `Agentic-Job-Apply-Companion` to ensure structured data and protect users from fake postings.
4. **Data Security:** Implement local encrypted storage (like `job-application-agent`) for sensitive credentials and profile data, coupled with manual credential entry or human-in-the-loop pauses (like `job-agent` and `Agentic-Job-Apply-Companion`) to handle MFA/CAPTCHAs securely.
5. **Notifications:** If a background daemon is desired, incorporate something like Telegram/Slack notifications inspired by `JobHunterCat`.
