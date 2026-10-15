# Opportunity feeds on X

Job Agent shows these accounts as links in the Job Discovery "Opportunity feeds on X" card
(served from `server/src/discovery/xSources.json` via `GET /api/discovery/x-sources`). There is
no automated ingestion: the X API is paid and scraping X is not allowed.

**Checked: 2026-10-15.** X profile pages could not be opened directly from the research
environment (X returns a login/paywall to automated clients), so each account below was
found through web-search listings of its X profile. That shows the account exists and what
it says it posts; recent activity and quality were **not** independently confirmed. None of
them specifically targets the 2027/2028 batches — they post intern/fresher openings in
general. Open a profile and check its last few posts before relying on it. No handle here
was guessed or invented.

| Handle | What it posts (per its profile listing) | Evidence |
|---|---|---|
| [@fjafreshers](https://x.com/fjafreshers) — Freshers IT Jobs Updates | Frequent fresher/graduate openings at large Indian IT employers, with company, role, eligibility and location | Web search "X accounts to follow for tech internships and fresher jobs India" returned the profile page https://x.com/fjafreshers with this description |
| [@Fresherflow](https://x.com/Fresherflow) — FresherFlow | Self-described "verified jobs, internships and walk-in drives" for students and fresh graduates across India | Same search returned https://x.com/Fresherflow |
| [@fresherscampus](https://x.com/fresherscampus) — Freshers Tech | Off-campus fresher drives and internships (snippets showed a Deloitte 2026 fresher drive and a Qualcomm internship); bio links fresherstech.com; posting looked sparse | Search for off-campus fresher hiring X handles returned https://twitter.com/fresherscampus |

Considered and left out: @TechJobOpening (search listing showed no activity for ~1,369 days).

The card also links an X live search you can tune:
`(internship OR intern) (hiring OR apply) (2028 OR 2027 OR "2028 batch") india min_faves:20`
(the batch years come from your profile's graduation year).

To add an account: confirm it exists and posts relevant openings, then add it to
`xSources.json` with the evidence link and date, and to this table.
