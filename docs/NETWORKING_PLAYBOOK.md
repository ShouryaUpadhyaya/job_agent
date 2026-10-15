# Networking & Referral Playbook

These rules shape the Networking CRM: priority scoring, the "people to message today" list, and the message generator prompts in `server/src/networking/`.

## A note on sources

The goal was to learn from Reddit discussions (r/developersIndia, r/csMajors, r/cscareerquestions, r/InternshipsIndia). Reddit blocks the research tools used here, both its JSON API and its web pages. Reddit content was therefore only reachable through search-engine summaries of individual threads, so most of the advice below comes from similar community sources: Blind threads, an IIT Madras student blog, and career guides. Each point lists where it came from. If you find Reddit threads you like, add their advice here; the prompts read this file's principles indirectly through `networking/messagePrompts.ts`.

Checked: 2026-10-15.

## What the community advice agrees on

1. **Find the job yourself, then message with the job ID or link.** Referrers can only refer you to a specific opening, so do the search first and include the ID or URL. A highly upvoted r/developersIndia comment (via search summary, Jul 2024) gave this advice, and Blind referrers repeatedly ask for it. Some referrers will match you to a role themselves, but don't rely on that.
2. **Message engineers, not only recruiters.** Several people said recruiter DMs rarely turned into conversations, while messages to software engineers at the target company led to referrals. The Blind post "4 ways to get referred" credits developer outreach for referrals at Twilio, Oracle and Snowflake.
3. **Use shared ground, especially your college.** Alumni are the warmest cold contact. One student found a contact by filtering their college's LinkedIn alumni page by company and seniority, then sending short direct messages; they reviewed about 50 to 60 profiles and got a reply the next day (IIT Madras Chennai36 blog; jobrise.io internship guide). For you this means **VIT Vellore alumni at companies you've applied to come first**.
4. **Be direct and short, and get to the point.** Avoid "Hi, how are you?" openers. State who you are, which role, and why you fit, in a few lines (telecomhall referral etiquette; jobright.ai internship guide).
5. **Make it easy to help.** Include the job link or ID, a one-line pitch, and a resume link the person can forward. Don't ask "how should I send my resume?" (an engineering manager's advice on Blind; happenstance.ai).
6. **Give them an easy way to decline.** Something like "No worries if you're not the right person" lowers the pressure (Nasdaq, quoting a career coach).
7. **Follow up once, politely, with substance.** Don't send bare "??" follow-ups; referrers get many requests (telecomhall).
8. **Expect a low reply rate and treat it as a numbers game with quality messages.** Most cold messages go unanswered (Fishbowl thread; a tier-3 fresher thread on Blind). The CRM should push volume of good messages: several people per company, prioritised.
9. **Verifiable credentials help.** People asking for referrals list concrete proof such as projects with users, ratings or internships (Blind referral threads). Your strongest proofs are Moss X production work (Razorpay payments, Redis caching under 50 ms), OpenPumTa (1,500+ visitors, 30+ APIs, monitoring) and Cook Off 10.0 (1,000+ users).
10. **Off-campus routes for Indian students.** Apply directly on company career pages and LinkedIn, and treat Internshala as a backup, since fewer large companies use it (IIT Madras Chennai36 blog).

## How the app applies this

| Principle | Implementation |
|---|---|
| Alumni and engineers first | The priority score adds weight for `school` containing VIT and for ENGINEER/FULLSTACK personas, and ranks recruiters lower. Founders and CTOs get high weight at small startups only. |
| Job ID or link | Referral-ask drafts always include the job title plus the job URL or ID from the linked application. If no job is linked, the generator asks you to link one. |
| Short and direct | Connection notes are 300 characters or fewer (LinkedIn's note limit). Referral asks are 120 words or fewer. No small-talk opener. |
| Shared ground | The alumni line ("fellow VITian") is used only when the contact's `school` actually mentions VIT. It is never assumed. |
| Easy decline | Every referral ask ends with a low-pressure line. |
| One follow-up | Follow-up drafts are offered 5 to 7 days after a message is marked sent, once. After that the contact goes to "no reply". |
| Proof | The generator uses your best resume for the role and picks 1 or 2 concrete, true achievements. It never invents facts. |
| Sequence | Connect (note) → after acceptance, a thank-you plus a short ask → share the job link and resume → one follow-up. |

## Message sequence

1. **Connection note** (≤300 characters): who you are, the shared ground, and the specific reason (the role or team). Don't ask for a referral here unless the person is a recruiter for that role.
2. **After they accept:** thanks, the role with its link or ID, one or two lines of proof, and the referral ask with an easy decline.
3. **Follow-up** (once, 5 to 7 days later): a short nudge, ideally with something new such as an assessment cleared or a project shipped.
4. **Thank-you** after any help, whether or not the referral worked. This keeps the relationship.

## Sources
- r/developersIndia thread, Jul 2024, seen only through a search-engine summary because Reddit was not directly accessible: https://www.reddit.com/r/developersIndia/
- Blind, "4 ways to get referred": https://www.teamblind.com/post/4-ways-to-get-referred-hxdsvo4f
- Blind referral request threads (India intern/new-grad), e.g. https://www.teamblind.com/post/referral-for-swemts-internship-m84n4uyv
- IIT Madras Chennai36, off-campus internships: https://chennai36.iitm.ac.in/post/through-the-linkedin-glass-off-campus-internships
- jobrise.io internship guide: https://jobrise.io/en/blog/internship-kaise-milegi-tips/
- jobright.ai, cold messaging for internships: https://jobright.ai/blog/how-to-cold-message-linkedin-internship/
- Telecomhall, referral etiquette: https://www.telecomhall.net/t/basic-etiquettes-when-asking-for-a-job-referral/27058
- Nasdaq, asking for a referral: https://www.nasdaq.com/articles/how-ask-referral-without-embarrassing-yourself-2018-05-02
- happenstance.ai, how to ask for a referral: https://happenstance.ai/how-to/ask-someone-to-refer-you-for-a-job
- Fishbowl, cold messaging tips: https://www.fishbowlapp.com/post/tips-on-cold-messaging-people-on-linkedin-for-jobscoffee-chats-referrals-i-have-been-finding-relevant-roles-but-dont-have
