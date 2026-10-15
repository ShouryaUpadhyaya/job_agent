# Job sources

Job Agent only reads **official public job APIs**. It never scrapes or calls LinkedIn or
Naukri (their terms forbid automated access); jobs from those sites arrive through their
job-alert emails (Gmail sync → `server/src/discovery/jobAlerts.ts`), the prefilled search
links you open yourself, or details you paste with **Add job manually**.

| Type | Endpoint | Token | Notes |
|---|---|---|---|
| `greenhouse` | `https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | board token | per-job liveness: `/boards/{token}/jobs/{id}` |
| `lever` | `https://api.lever.co/v0/postings/{slug}?mode=json` | company slug | per-job liveness: `/postings/{slug}/{id}` |
| `ashby` | `https://api.ashbyhq.com/posting-api/job-board/{slug}` | org slug | liveness: board re-fetched once per check run |
| `smartrecruiters` | `https://api.smartrecruiters.com/v1/companies/{id}/postings` | company id (case-sensitive) | list has no descriptions; details fetched for up to 60 tech roles per sync |
| `workable` | `https://apply.workable.com/api/v1/widget/accounts/{subdomain}?details=true` | account subdomain | verified 2026-10-15 (the endpoint behind apply.workable.com pages) |
| `remotive` | `https://remotive.com/api/remote-jobs?category=software-dev` | category | Terms: link back to Remotive and credit it; poll ≤ 4×/day. Listings keep their remotive.com URL, are tagged "via Remotive", and the connector skips syncs within 6 h. |
| `remoteok` | `https://remoteok.com/api` | — | First array element is the legal notice. Terms: link back to Remote OK and mention it as the source. Tagged "via Remote OK"; 6 h minimum interval; only dev-tagged jobs kept. |
| `arbeitnow` | `https://www.arbeitnow.com/api/job-board-api` | — | Europe-heavy; paginated (5 pages). Not in the defaults. |
| `rss` / `jsonapi` | any feed URL | feed URL | Generic mappers; LinkedIn/Naukri URLs are rejected. |

LinkedIn and Wellfound connector rows from older versions are disabled automatically
(`ensureDefaultSources`) and cannot be re-enabled.

## Curated defaults

`server/src/connectors/registry.ts` → `DEFAULT_SOURCES`. `ensureDefaultSources()` adds any
missing default and never deletes or re-enables sources you changed.

Verified **2026-10-15** by calling each public API. Counts are open postings at that time:
total / located in India (city match) / India software roles / intern-or-graduate titles.
Only tokens that answered with jobs were kept.

| ATS | Token | Company | Total | India | India SWE | Intern/grad |
|---|---|---|---|---|---|---|
| greenhouse | razorpaysoftwareprivatelimited | Razorpay | 28 | 23 | 2 | 0 |
| greenhouse | groww | Groww | 11 | 11 | 0 | 3 |
| greenhouse | databricks | Databricks | 891 | 95 | 62 | 28 |
| greenhouse | stripe | Stripe | 728 | 46 | 8 | 37 |
| greenhouse | coinbase | Coinbase (remote) | 225 | 9 | 7 | 33 |
| greenhouse | mongodb | MongoDB | 401 | 85 | 37 | 4 |
| greenhouse | rubrik | Rubrik | 136 | 36 | 11 | 5 |
| greenhouse | twilio | Twilio | 141 | 18 | 13 | 3 |
| greenhouse | okta | Okta | 372 | 108 | 83 | 1 |
| greenhouse | hackerrank | HackerRank | 33 | 21 | 15 | 2 |
| greenhouse | zscaler | Zscaler | 365 | 65 | 42 | 0 |
| greenhouse | gitlab | GitLab (remote) | 215 | 29 | 20 | 1 |
| greenhouse | highradius | HighRadius | 77 | 51 | 11 | 0 |
| greenhouse | druva | Druva | 34 | 13 | 9 | 0 |
| greenhouse | netskope | Netskope | 135 | 20 | 16 | 0 |
| greenhouse | inmobi | InMobi | 77 | 41 | 3 | 1 |
| greenhouse | observeai | Observe.AI | 9 | 4 | 2 | 0 |
| greenhouse | cloudflare | Cloudflare (kept from old defaults) | 445 | 1 | 1 | 5 |
| lever | cred | CRED | 7 | 7 | 0 | 0 |
| lever | meesho | Meesho | 58 | 56 | 8 | 1 |
| lever | zeta | Zeta | 26 | 23 | 6 | 0 |
| lever | fampay | FamPay | 17 | 17 | 5 | 2 |
| lever | paytm | Paytm | 182 | 149 | 1 | 7 |
| lever | outreach | Outreach | 23 | 5 | 3 | 0 |
| ashby | sarvam | Sarvam AI | 42 | 42 | 16 | 2 |
| ashby | plane | Plane | 33 | 10 | 7 | 0 |
| ashby | composio | Composio | 30 | 3 | 1 | 4 |
| ashby | spotdraft | SpotDraft | 15 | 11 | 1 | 0 |
| ashby | atlan | Atlan | 7 | 4 | 2 | 0 |
| ashby | posthog | PostHog (remote) | 11 | 0 | 0 | 0 |
| ashby | notion | Notion | 130 | 2 | 2 | 4 |
| ashby | clickhouse | ClickHouse | 198 | 9 | 3 | 2 |
| ashby | linear | Linear (remote, kept from old defaults) | 30 | 0 | 0 | 0 |
| smartrecruiters | Freshworks | Freshworks | 130 | 31* | 18* | 0* |
| smartrecruiters | ServiceNow | ServiceNow | 673 | 17* | 12* | 4* |
| smartrecruiters | Swiggy | Swiggy | 197 | 100* | 4* | 0* |
| smartrecruiters | Experian | Experian | 395 | 15* | 8* | 1* |
| workable | apna | Apna | 143 | 143 | 6 | 15 |
| remotive | software-dev | Remotive | — | — | — | — |
| remoteok | dev | Remote OK | — | — | — | — |

\* first 100 postings sampled.

Tokens that did **not** respond (404/empty) on 2026-10-15 and were left out: Greenhouse —
postman, phonepe, cred, zomato, browserstack, meesho, atlassian, swiggy, cohesity, sprinklr,
nutanix, uber, flipkart, freshworks, rippling, snowflake, canva; Lever — razorpay, groww,
phonepe, swiggy, zepto, browserstack, postman, atlassian, unacademy; Ashby — zepto, razorpay,
groww, postman, cred, juspay; SmartRecruiters — Atlassian, Razorpay, PhonePe, Flipkart, Meesho,
Zomato, Paytm; Workable — razorpay, cred, zepto, juspay. Re-check before adding them by hand
(`curl` the endpoint above) — companies move between ATSs.

## Liveness

- After every **successful** sync of a feed, its active listings that were not returned get
  `missedSyncs + 1`; at 2 they are closed (`isActive=false`, `closedReason='not_in_feed'`).
  A listing returned again is reactivated. An empty response is ignored (likely an API
  hiccup). Email and manual listings are exempt.
- `checkStaleListings()` (`server/src/jobs/liveness.ts`) checks active listings older than 7
  days that were not checked in 24 h, one request per second: ATS per-job APIs where
  available, otherwise a GET of the job URL (404/410 or "no longer accepting applications"
  style pages close it). LinkedIn/Naukri URLs are never fetched; the API marks them
  "Unverified, older than N days".
