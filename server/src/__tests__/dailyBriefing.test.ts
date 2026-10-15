import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';

vi.mock('../lib/gemini', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/gemini')>();
  return { ...actual, generateText: vi.fn(async () => null), isGeminiConfigured: vi.fn(() => false) };
});

import { app } from '../app';
import { prisma } from '../db';
import { generateText, isGeminiConfigured } from '../lib/gemini';
import { buildBriefing, extractDeadline } from '../briefing/build';
import { dailyBriefingService } from '../briefing/summary';
import { parseStoredContent, renderMarkdown, toStoredContent } from '../briefing/render';
import { validInShort } from '../briefing/inShort';
import { parseHistoryLimit } from '../api/briefing';
import { Briefing } from '../briefing/types';

const DAY = 24 * 60 * 60 * 1000;
// 2026-10-15 20:30 IST
const NOW = new Date('2026-10-15T15:00:00.000Z');
const ago = (days: number, from = NOW) => new Date(from.getTime() - days * DAY);
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

async function wipe() {
  await prisma.dailyJobSearchSummary.deleteMany();
  await prisma.emailEvent.deleteMany();
  await prisma.networkingMessage.deleteMany();
  await prisma.networkingContact.deleteMany();
  await prisma.document.deleteMany();
  await prisma.jobApplication.deleteMany();
  await prisma.resume.deleteMany();
  await prisma.candidateProfile.deleteMany();
  await prisma.jobListing.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.wellfoundRun.deleteMany();
}

let seq = 0;
async function job(data: Partial<Parameters<typeof prisma.jobListing.create>[0]['data']> & { company: string }) {
  seq++;
  return prisma.jobListing.create({
    data: {
      externalId: `brief-${seq}`,
      source: 'greenhouse',
      title: `Software Engineer Intern ${seq}`,
      url: `https://example.com/jobs/${seq}`,
      description: 'Role',
      score: 70,
      status: 'APPLY',
      createdAt: ago(30),
      ...data,
      companyKey: data.company.toLowerCase(),
    },
  });
}

let profileId = '';
async function application(jobId: string, company: string, stage: string, extra: Record<string, unknown> = {}) {
  return prisma.jobApplication.create({
    data: { jobListingId: jobId, candidateProfileId: profileId, stage, companyKey: company.toLowerCase(), ...extra },
  });
}

let msgSeq = 0;
async function email(data: Record<string, unknown>) {
  msgSeq++;
  return prisma.emailEvent.create({
    data: { messageId: `brief-msg-${msgSeq}`, sender: 'hr@example.com', subject: 'Hello', receivedAt: hoursAgo(2), classification: 'UNKNOWN', ...data } as any,
  });
}

async function contact(data: Record<string, unknown>) {
  return prisma.networkingContact.create({
    data: { name: 'Someone', company: 'Acme', companyKey: 'acme', role: 'Software Engineer', persona: 'ENGINEER', ...data } as any,
  });
}

describe('Daily briefing', () => {
  beforeEach(async () => {
    await wipe();
    vi.mocked(generateText).mockReset().mockResolvedValue(null);
    vi.mocked(isGeminiConfigured).mockReturnValue(false);
    const profile = await prisma.candidateProfile.create({
      data: { name: 'Asha Rao', targetRole: 'Software Engineer Intern', skills: ['TypeScript'] },
    });
    profileId = profile.id;
  });

  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  describe("today's actions", () => {
    it('lists open interviews/assessments with deadlines, recruiter replies, offers and due follow-ups', async () => {
      const acme = await job({ company: 'Acme' });
      const beta = await job({ company: 'Beta' });
      const acmeApp = await application(acme.id, 'Acme', 'INTERVIEWING');
      const betaApp = await application(beta.id, 'Beta', 'REJECTED');

      const interview = await email({
        classification: 'INTERVIEW_INVITATION',
        company: 'Acme',
        subject: 'Interview with Acme',
        suggestedAction: 'Pick a slot. Deadline: Oct 18.',
        jobApplicationId: acmeApp.id,
        receivedAt: ago(2),
      });
      // Superseded: a later rejection on the same application.
      await email({ classification: 'ASSESSMENT', company: 'Beta', jobApplicationId: betaApp.id, receivedAt: ago(4) });
      await email({ classification: 'REJECTION', company: 'Beta', jobApplicationId: betaApp.id, receivedAt: ago(1) });
      // Demo and old events are ignored.
      await email({ classification: 'INTERVIEW_INVITATION', company: 'Demo', isDemo: true });
      await email({ classification: 'INTERVIEW_INVITATION', company: 'Old', receivedAt: ago(9) });
      await email({ classification: 'RECRUITER_OUTREACH', company: 'Gamma', senderName: 'Rita Recruiter' });
      await email({ classification: 'OFFER', company: 'Delta', subject: 'Offer letter' });

      const due = await contact({ name: 'Due Person', status: 'MESSAGE_SENT', nextFollowUpAt: ago(1) });
      await contact({ name: 'Replied Person', status: 'REPLIED', nextFollowUpAt: ago(1) });
      await contact({ name: 'Old Accept', status: 'ACCEPTED', acceptedAt: ago(30), nextFollowUpAt: ago(30) });
      const fresh = await contact({ name: 'Fresh Accept', status: 'ACCEPTED', acceptedAt: ago(1), nextFollowUpAt: ago(1) });
      await contact({ name: 'Later Person', status: 'MESSAGE_SENT', nextFollowUpAt: new Date(NOW.getTime() + 2 * 60 * 60 * 1000) });

      const b = await buildBriefing(NOW);
      const actions = b.sections.find((s) => s.key === 'actions')!;
      const keys = actions.items.map((i) => i.key);

      expect(keys).toContain(`INTERVIEW_INVITATION:${interview.id}`);
      const iv = actions.items.find((i) => i.key === `INTERVIEW_INVITATION:${interview.id}`)!;
      expect(iv.tags).toContain('Deadline: Oct 18');
      expect(iv.link).toEqual({ tab: 'PIPELINE', id: acmeApp.id, label: 'Open application' });
      expect(actions.items.some((i) => i.kind === 'ASSESSMENT')).toBe(false);
      expect(actions.items.some((i) => /Demo|Old/.test(i.title))).toBe(false);
      expect(actions.items.some((i) => i.kind === 'RECRUITER_OUTREACH' && /Rita Recruiter/.test(i.title))).toBe(true);
      expect(actions.items[0].kind).toBe('OFFER');

      expect(keys).toContain(`followup:${due.id}`);
      expect(keys).toContain(`followup:${fresh.id}`);
      expect(actions.items.some((i) => /Replied Person|Old Accept|Later Person/.test(i.title))).toBe(false);
      expect(b.counts.needsAttentionCount).toBe(actions.items.length);
    });
  });

  describe('networking', () => {
    it('picks people at applied/interviewing companies, VIT alumni first, with draft state', async () => {
      const acme = await job({ company: 'Acme' });
      await application(acme.id, 'Acme', 'APPLIED', { submittedAt: ago(3) });
      const other = await job({ company: 'Other' });
      await application(other.id, 'Other', 'BOOKMARKED');

      const alumni = await contact({ name: 'Alumni Low', persona: 'RECRUITER', vitAlumni: true });
      const strong = await contact({ name: 'Engineer High', linkedinUrl: 'https://linkedin.com/in/eh', school: null });
      await prisma.networkingMessage.create({ data: { contactId: strong.id, type: 'CONNECTION_NOTE', content: 'Hi', status: 'DRAFT' } });
      await contact({ name: 'Referred Already', status: 'REFERRED', vitAlumni: true });
      await contact({ name: 'Waiting Person', status: 'REQUEST_SENT', nextFollowUpAt: new Date(NOW.getTime() + 3 * DAY) });
      await contact({ name: 'Elsewhere', company: 'Other', companyKey: 'other', vitAlumni: true });

      const b = await buildBriefing(NOW);
      const s = b.sections.find((x) => x.key === 'networking')!;
      expect(s.items.map((i) => i.key)).toEqual([`person:${alumni.id}`, `person:${strong.id}`]);
      expect(s.items[0].tags).toContain('VIT alumni');
      expect(s.items[1].tags).toContain('Draft ready');
      expect(s.items[1].link?.tab).toBe('NETWORKING');
    });
  });

  describe('new matches', () => {
    it('lists active, unapplied, undismissed APPLY/REVIEW internship-friendly listings since the last briefing', async () => {
      await prisma.dailyJobSearchSummary.create({
        data: { summaryDate: new Date('2026-10-14T00:00:00.000Z'), content: 'x', generatedAt: hoursAgo(24) },
      });
      const resume = await prisma.resume.create({ data: { candidateProfileId: profileId, label: 'Backend', content: 'x' } });
      const best = await job({ company: 'NewCo', score: 92, createdAt: hoursAgo(3), bestResumeId: resume.id, isInternship: true });
      const second = await job({ company: 'NewCo2', score: 80, createdAt: hoursAgo(5), status: 'REVIEW' });
      await job({ company: 'Older', score: 99, createdAt: hoursAgo(30) });
      await job({ company: 'Dismissed', score: 99, createdAt: hoursAgo(2), userStatus: 'DISMISSED' });
      await job({ company: 'Pass', score: 99, createdAt: hoursAgo(2), status: 'PASS' });
      await job({ company: 'Closed', score: 99, createdAt: hoursAgo(2), isActive: false });
      await job({ company: 'FullTime', score: 99, createdAt: hoursAgo(2), employmentType: 'FULL_TIME' });
      const applied = await job({ company: 'Applied', score: 99, createdAt: hoursAgo(2) });
      await application(applied.id, 'Applied', 'APPLIED');

      const b = await buildBriefing(NOW);
      const s = b.sections.find((x) => x.key === 'matches')!;
      expect(s.items.map((i) => i.key)).toEqual([`match:${best.id}`, `match:${second.id}`]);
      expect(s.items[0].tags).toContain('Use: Backend resume');
      expect(s.items[0].externalUrl).toBe(best.url);
      expect(s.items[0].link).toMatchObject({ tab: 'DISCOVERY', id: best.id });
      expect(b.matchesSince).toBe(hoursAgo(24).toISOString());
    });
  });

  describe('pipeline movement and counts', () => {
    it('counts new applications by submittedAt in the IST day, stage changes, rejections and offers', async () => {
      const a = await job({ company: 'Acme' });
      const b2 = await job({ company: 'Beta' });
      const c = await job({ company: 'Gamma' });
      const d = await job({ company: 'Delta' });
      // Submitted today (IST) vs. yesterday 23:00 IST (= 17:30 UTC on the 14th).
      await application(a.id, 'Acme', 'APPLIED', { submittedAt: hoursAgo(1) });
      await application(b2.id, 'Beta', 'APPLIED', { submittedAt: new Date('2026-10-14T17:30:00.000Z') });
      const moved = await application(c.id, 'Gamma', 'INTERVIEWING', { submittedAt: ago(5) });
      await prisma.auditLog.create({
        data: {
          action: 'JOB_APPLICATION_UPDATED',
          entityId: moved.id,
          timestamp: hoursAgo(3),
          metadata: { changes: { stage: 'INTERVIEWING' }, from: { stage: 'APPLIED' } },
        },
      });
      const rejected = await application(d.id, 'Delta', 'REJECTED', { submittedAt: ago(10) });
      await email({ classification: 'REJECTION', company: 'Delta', jobApplicationId: rejected.id, receivedAt: hoursAgo(4) });
      await email({ classification: 'OFFER', company: 'Unlinked Co', receivedAt: hoursAgo(1) });
      await email({ classification: 'REJECTION', company: 'Demo', isDemo: true, receivedAt: hoursAgo(1) });

      const brief = await buildBriefing(NOW);
      const s = brief.sections.find((x) => x.key === 'movement')!;
      expect(brief.counts.newApplicationsCount).toBe(1);
      expect(brief.counts.interviewsCount).toBe(1);
      expect(brief.counts.rejectionsCount).toBe(1);
      expect(brief.counts.offersCount).toBe(1);
      const titles = s.items.map((i) => i.title);
      expect(titles.some((t) => /Gamma: Applied → Interviewing/.test(t))).toBe(true);
      expect(titles.some((t) => /Delta: Rejected/.test(t))).toBe(true);
      expect(titles.some((t) => /^Applied: .* at Acme/.test(t))).toBe(true);
      expect(titles.some((t) => /Beta/.test(t))).toBe(false);
      expect(s.items.some((i) => i.kind === 'OFFER' && i.link?.tab === 'GMAIL')).toBe(true);
    });
  });

  describe('wellfound, stale applications and stats', () => {
    it('summarises runs, flags stale applications with people counts and compares weeks', async () => {
      await prisma.wellfoundRun.create({ data: { mode: 'LIVE', status: 'SUCCEEDED', startedAt: hoursAgo(5), submittedCount: 4 } });
      const failed = await prisma.wellfoundRun.create({
        data: { mode: 'DRY_RUN', status: 'FAILED', startedAt: hoursAgo(2), errorCount: 1, error: 'Login expired', diagnosticsDir: '/tmp/x' },
      });
      await prisma.wellfoundRun.create({ data: { mode: 'LIVE', status: 'SUCCEEDED', startedAt: ago(2), submittedCount: 9 } });

      const s1 = await job({ company: 'Stale' });
      const staleApp = await application(s1.id, 'Stale', 'APPLIED', { submittedAt: ago(20) });
      await contact({ name: 'Stale Contact', company: 'Stale', companyKey: 'stale' });
      const s2 = await job({ company: 'Answered' });
      const answered = await application(s2.id, 'Answered', 'APPLIED', { submittedAt: ago(20), lastEmailAt: ago(3) });
      await email({ classification: 'RECRUITER_OUTREACH', company: 'Answered', jobApplicationId: answered.id, receivedAt: ago(3) });
      const s3 = await job({ company: 'Lonely' });
      const lonely = await application(s3.id, 'Lonely', 'APPLIED', { submittedAt: ago(16) });

      // Stats: one application this week (staleness aside), one last week.
      const w1 = await job({ company: 'Week1' });
      await application(w1.id, 'Week1', 'APPLIED', { submittedAt: ago(2) });
      const w2 = await job({ company: 'Week2' });
      await application(w2.id, 'Week2', 'APPLIED', { submittedAt: ago(9) });
      await email({ classification: 'INTERVIEW_INVITATION', company: 'X', receivedAt: ago(1) });
      const messaged = await contact({ name: 'Messaged', company: 'Zed', companyKey: 'zed' });
      await prisma.networkingMessage.create({ data: { contactId: messaged.id, type: 'REFERRAL_ASK', content: 'Hi', status: 'SENT', sentAt: ago(1) } });

      const b = await buildBriefing(NOW);
      const wf = b.sections.find((x) => x.key === 'wellfound')!;
      expect(wf.items).toHaveLength(2);
      const bad = wf.items.find((i) => i.key === `wellfound:${failed.id}`)!;
      expect(bad.urgency).toBe('high');
      expect(bad.link).toMatchObject({ tab: 'WELLFOUND', id: failed.id, label: 'Open run diagnostics' });
      expect(wf.summary).toMatch(/2 runs · 4 submitted/);

      const stale = b.sections.find((x) => x.key === 'stale')!;
      expect(stale.items.map((i) => i.key)).toEqual([`stale:${staleApp.id}`, `stale:${lonely.id}`]);
      expect(stale.items[0].tags).toContain('1 contact');
      expect(stale.items[0].link).toMatchObject({ tab: 'NETWORKING', params: { companyKey: 'stale' } });
      expect(stale.items[1].link).toMatchObject({ tab: 'PIPELINE', id: lonely.id });

      expect(b.stats.thisWeek.applications).toBe(1);
      expect(b.stats.lastWeek.applications).toBe(1);
      expect(b.stats.thisWeek.interviews).toBe(1);
      expect(b.stats.thisWeek.responses).toBe(2);
      expect(b.stats.thisWeek.contactsMessaged).toBe(1);
      expect(b.stats.thisWeekRange).toEqual({ from: '2026-10-09', to: '2026-10-15' });
    });
  });

  describe('persistence', () => {
    it('stores one row per IST day with markdown, structured data and count columns', async () => {
      const a = await job({ company: 'Acme' });
      await application(a.id, 'Acme', 'APPLIED', { submittedAt: hoursAgo(1) });

      const res = await dailyBriefingService.generate(NOW, 'scheduled');
      expect(res.date).toBe('2026-10-15');
      expect(res.newApplicationsCount).toBe(1);
      expect(res.content).toContain('# Daily briefing — Thursday, 15 October 2026');
      expect(res.content).toMatch(/Generated 8:30\s?(pm|PM) IST \(scheduled\)/);
      expect(res.content).toContain('for Asha Rao');
      expect(res.content).not.toContain('Shourya');
      expect(res.content).not.toContain('briefing-data');
      expect(res.briefing?.sections.map((s) => s.key)).toEqual(['actions', 'networking', 'matches', 'movement', 'wellfound', 'stale']);

      // Regenerating the same day updates the row instead of adding one.
      await dailyBriefingService.generate(new Date(NOW.getTime() + 60 * 60 * 1000), 'manual');
      const rows = await prisma.dailyJobSearchSummary.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0].summaryDate.toISOString()).toBe('2026-10-15T00:00:00.000Z');
      expect(rows[0].newApplicationsCount).toBe(1);
      expect(parseStoredContent(rows[0].content).briefing?.trigger).toBe('manual');
    });

    it('keys 00:00-05:30 IST to the IST date, not the UTC date', async () => {
      const earlyIst = new Date('2026-10-15T19:00:00.000Z'); // 00:30 IST on Oct 16
      const res = await dailyBriefingService.generate(earlyIst, 'manual');
      expect(res.date).toBe('2026-10-16');
      const today = await dailyBriefingService.getToday(earlyIst);
      expect(today.id).toBe(res.id);
    });

    it('decides whether the scheduled run is due from the stored row', async () => {
      const before = new Date('2026-10-15T14:00:00.000Z'); // 19:30 IST
      expect(await dailyBriefingService.isScheduledRunDue(before)).toBe(false);
      await dailyBriefingService.generate(before, 'on-demand'); // morning/afternoon view
      expect(await dailyBriefingService.isScheduledRunDue(NOW)).toBe(true);
      await dailyBriefingService.generate(NOW, 'scheduled');
      expect(await dailyBriefingService.isScheduledRunDue(new Date(NOW.getTime() + 60 * 60 * 1000))).toBe(false);
    });
  });

  describe('In short', () => {
    it('uses a validated Gemini line when configured, rules otherwise', async () => {
      const rules = await buildBriefing(NOW, { useAi: true });
      expect(rules.inShort.source).toBe('rules');
      expect(rules.inShort.text.length).toBeGreaterThan(10);
      expect(generateText).not.toHaveBeenCalled();

      vi.mocked(isGeminiConfigured).mockReturnValue(true);
      vi.mocked(generateText).mockResolvedValueOnce('Nothing urgent today. Spend the evening messaging two engineers and reviewing new matches.');
      const ai = await buildBriefing(NOW, { useAi: true });
      expect(ai.inShort).toEqual({ source: 'gemini', text: 'Nothing urgent today. Spend the evening messaging two engineers and reviewing new matches.' });
      const prompt = vi.mocked(generateText).mock.calls[0][0];
      expect(prompt).toContain('<untrusted source="briefing">');

      vi.mocked(generateText).mockResolvedValueOnce('Visit https://evil.example to [Your Name] now please ok.');
      const bad = await buildBriefing(NOW, { useAi: true });
      expect(bad.inShort.source).toBe('rules');
    });

    it('validInShort rejects placeholders, links and long text', () => {
      expect(validInShort('Short.')).toBeNull();
      expect(validInShort('Reply to [Recruiter Name] about the interview slot today.')).toBeNull();
      expect(validInShort('x'.repeat(500))).toBeNull();
      expect(validInShort('**Focus** on the Acme interview first, then message two alumni.')).toBe(
        'Focus on the Acme interview first, then message two alumni.'
      );
    });
  });

  describe('API', () => {
    it('GET /today generates once, /live is not persisted, /generate regenerates, /history validates limit', async () => {
      const first = await request(app).get('/api/briefing/today');
      expect(first.status).toBe(200);
      expect(first.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(first.body.briefing.trigger).toBe('on-demand');
      expect(first.body.content).toContain('# Daily briefing');

      const again = await request(app).get('/api/briefing/today');
      expect(again.body.id).toBe(first.body.id);

      const live = await request(app).get('/api/briefing/live');
      expect(live.status).toBe(200);
      expect(live.body.persisted).toBe(false);
      expect(live.body.briefing.trigger).toBe('live');
      expect(await prisma.dailyJobSearchSummary.count()).toBe(1);

      const regen = await request(app).post('/api/briefing/generate');
      expect(regen.status).toBe(200);
      expect(regen.body.id).toBe(first.body.id);
      expect(regen.body.briefing.trigger).toBe('manual');

      const history = await request(app).get('/api/briefing/history');
      expect(history.status).toBe(200);
      expect(history.body).toHaveLength(1);
      expect(history.body[0].date).toBe(first.body.date);
      expect(history.body[0].summaryDate).toBe(first.body.date);

      expect((await request(app).get('/api/briefing/history?limit=abc')).status).toBe(400);
      expect((await request(app).get('/api/briefing/history?limit=0')).status).toBe(400);
      expect((await request(app).get('/api/briefing/history?limit=500')).status).toBe(200);
    });

    it('parseHistoryLimit defaults to 14 and clamps to 60', () => {
      expect(parseHistoryLimit(undefined)).toBe(14);
      expect(parseHistoryLimit('7')).toBe(7);
      expect(parseHistoryLimit('500')).toBe(60);
      expect(parseHistoryLimit('-1')).toBeNull();
      expect(parseHistoryLimit('3.5')).toBeNull();
    });
  });
});

describe('briefing helpers', () => {
  it('extractDeadline reads classifier deadlines and common phrasings', () => {
    expect(extractDeadline('Complete the test. Deadline: Friday 5 PM.')).toBe('Friday 5 PM');
    expect(extractDeadline(null, 'Please complete within 48 hours')).toBe('within 48 hours');
    expect(extractDeadline('Submit by Oct 20 to be considered')).toMatch(/^by Oct 20/);
    expect(extractDeadline('Thanks for applying')).toBeNull();
  });

  it('round-trips the structured briefing through stored content, even with "-->" in text', () => {
    const b: Briefing = {
      version: 1,
      date: '2026-10-15',
      generatedAt: NOW.toISOString(),
      trigger: 'manual',
      candidateName: null,
      inShort: { text: 'Do things -- now.', source: 'rules' },
      counts: {
        newApplicationsCount: 0,
        interviewsCount: 0,
        rejectionsCount: 0,
        acceptedConnectionsCount: 0,
        needsAttentionCount: 1,
        offersCount: 0,
        newMatchesCount: 0,
        staleCount: 0,
        wellfoundRunsCount: 0,
      },
      matchesSince: NOW.toISOString(),
      sections: [
        {
          key: 'actions',
          title: "Today's actions",
          emptyText: 'none',
          items: [{ key: 'x:1', kind: 'X', title: 'Weird --> title <b>', urgency: 'high', link: { tab: 'GMAIL', id: 'e1', label: 'Open email' } }],
        },
      ],
      stats: {
        thisWeek: { applications: 2, responses: 1, interviews: 0, contactsMessaged: 3 },
        lastWeek: { applications: 1, responses: 1, interviews: 0, contactsMessaged: 0 },
        thisWeekRange: { from: '2026-10-09', to: '2026-10-15' },
        lastWeekRange: { from: '2026-10-02', to: '2026-10-08' },
      },
    };
    const md = renderMarkdown(b);
    expect(md).toContain('(/?tab=GMAIL&id=e1)');
    expect(md).toContain('| Applications | 2 | 1 | +1 |');
    expect(md).not.toContain('briefing for');
    const stored = toStoredContent(b, md);
    const parsed = parseStoredContent(stored);
    expect(parsed.markdown).toBe(md);
    expect(parsed.briefing).toEqual(b);
    expect(parseStoredContent('# legacy markdown').briefing).toBeNull();
  });
});
