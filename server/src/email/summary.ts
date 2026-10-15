/**
 * Inbox summary for the last N days: what needs action, which applications moved because of
 * email, counts, new applications and job-alert listings. Demo events are excluded. An optional
 * Gemini paraphrase (`aiSummary`) is added only when GEMINI_KEY is set; the deterministic
 * `highlights` are always present.
 */
import { prisma } from '../db';
import { generateText, isGeminiConfigured, toPlainText } from '../lib/gemini';
import { extractDeadline } from './classifier';
import { parseStageMarker } from './effects';

const DAY_MS = 24 * 60 * 60 * 1000;

export type NeedsActionKind = 'INTERVIEW' | 'ASSESSMENT' | 'OFFER' | 'RECRUITER_REPLY' | 'FOLLOW_UP';

export interface NeedsActionItem {
  eventId: string;
  kind: NeedsActionKind;
  subject: string;
  company: string | null;
  role: string | null;
  sender: string;
  senderName: string | null;
  deadline: string | null;
  receivedAt: Date;
  suggestedAction: string | null;
  application: { id: string; stage: string; title: string; company: string } | null;
  contact: { id: string; name: string; company: string; status: string } | null;
  /** Dashboard deep link (`?tab=PIPELINE&id=<application>`, `?tab=NETWORKING&id=<contact>` or `?tab=GMAIL&id=<event>`). */
  link: string;
}

const KIND: Record<string, NeedsActionKind> = {
  INTERVIEW_INVITATION: 'INTERVIEW',
  ASSESSMENT: 'ASSESSMENT',
  OFFER: 'OFFER',
  RECRUITER_OUTREACH: 'RECRUITER_REPLY',
  REFERRAL_RESPONSE: 'RECRUITER_REPLY',
  FOLLOW_UP_REQUIRED: 'FOLLOW_UP',
};

export function clampDays(raw: unknown, fallback = 7): number {
  const n = parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 90) : fallback;
}

let aiCache: { key: string; text: string; at: number } | null = null;

export async function buildGmailSummary(days = 7, now = new Date(), opts: { ai?: boolean } = {}) {
  const since = new Date(now.getTime() - days * DAY_MS);
  const events = await prisma.emailEvent.findMany({
    where: { isDemo: false, receivedAt: { gte: since } },
    orderBy: { receivedAt: 'desc' },
    include: {
      jobApplication: { include: { jobListing: { select: { title: true, company: true } } } },
      networkingContact: { select: { id: true, name: true, company: true, status: true, lastContactAt: true } },
    },
  });

  const counts: Record<string, number> = {};
  for (const e of events) counts[e.classification] = (counts[e.classification] || 0) + 1;

  const needsAction: NeedsActionItem[] = [];
  for (const e of events) {
    const kind = KIND[e.classification];
    if (!kind) continue;
    const app = e.jobApplication;
    // An interview/assessment for an application that has since closed needs nothing.
    if (app && ['REJECTED', 'ARCHIVED'].includes(app.stage) && kind !== 'OFFER') continue;
    const contact = e.networkingContact;
    if (kind === 'RECRUITER_REPLY' || kind === 'FOLLOW_UP') {
      // Answered already if you logged contact with them after this email.
      if (contact?.lastContactAt && contact.lastContactAt.getTime() > e.receivedAt.getTime()) continue;
      if (contact && ['NOT_INTERESTED', 'REFERRED'].includes(contact.status) && kind === 'RECRUITER_REPLY' && e.classification !== 'REFERRAL_RESPONSE') continue;
    }
    needsAction.push({
      eventId: e.id,
      kind,
      subject: e.subject,
      company: e.company,
      role: e.role,
      sender: e.sender,
      senderName: e.senderName,
      deadline: ['INTERVIEW', 'ASSESSMENT', 'OFFER', 'FOLLOW_UP'].includes(kind) ? extractDeadline(e.body || e.snippet) ?? null : null,
      receivedAt: e.receivedAt,
      suggestedAction: e.suggestedAction,
      application: app ? { id: app.id, stage: app.stage, title: app.jobListing.title, company: app.jobListing.company } : null,
      contact: contact ? { id: contact.id, name: contact.name, company: contact.company, status: contact.status } : null,
      link: app ? `?tab=PIPELINE&id=${app.id}` : contact ? `?tab=NETWORKING&id=${contact.id}` : `?tab=GMAIL&id=${e.id}`,
    });
  }
  const rank: Record<NeedsActionKind, number> = { OFFER: 0, INTERVIEW: 1, ASSESSMENT: 2, RECRUITER_REPLY: 3, FOLLOW_UP: 4 };
  needsAction.sort((a, b) => Number(Boolean(b.deadline)) - Number(Boolean(a.deadline)) || rank[a.kind] - rank[b.kind] || b.receivedAt.getTime() - a.receivedAt.getTime());

  const statusChanges = events
    .map((e) => ({ e, change: parseStageMarker(e.explanation) }))
    .filter((x) => x.change && x.e.jobApplication)
    .map(({ e, change }) => ({
      eventId: e.id,
      applicationId: e.jobApplication!.id,
      company: e.jobApplication!.jobListing.company,
      title: e.jobApplication!.jobListing.title,
      from: change!.from,
      to: change!.to,
      at: e.receivedAt,
      currentStage: e.jobApplication!.stage,
    }));

  const newApps = await prisma.jobApplication.findMany({
    where: { source: 'email', createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    include: { jobListing: { select: { title: true, company: true } } },
  });
  const jobAlertListings = await prisma.jobListing.count({ where: { tags: { has: 'Job alert email' }, createdAt: { gte: since } } });

  const highlights: string[] = [];
  const nInterview = needsAction.filter((n) => n.kind === 'INTERVIEW').length;
  const nAssess = needsAction.filter((n) => n.kind === 'ASSESSMENT').length;
  const nOffer = needsAction.filter((n) => n.kind === 'OFFER').length;
  const nReplies = needsAction.filter((n) => n.kind === 'RECRUITER_REPLY' || n.kind === 'FOLLOW_UP').length;
  if (nOffer) highlights.push(`${nOffer} offer${nOffer > 1 ? 's' : ''} to review.`);
  if (nInterview) highlights.push(`${nInterview} interview invite${nInterview > 1 ? 's' : ''} to schedule.`);
  if (nAssess) highlights.push(`${nAssess} assessment${nAssess > 1 ? 's' : ''} to complete.`);
  if (nReplies) highlights.push(`${nReplies} email${nReplies > 1 ? 's' : ''} from people waiting on your reply.`);
  if (statusChanges.length) highlights.push(`${statusChanges.length} application${statusChanges.length > 1 ? 's' : ''} moved stage from email.`);
  if (newApps.length) highlights.push(`${newApps.length} new application${newApps.length > 1 ? 's' : ''} detected from confirmation emails.`);
  if (counts.REJECTION) highlights.push(`${counts.REJECTION} rejection${counts.REJECTION > 1 ? 's' : ''}.`);
  if (jobAlertListings) highlights.push(`${jobAlertListings} new listing${jobAlertListings > 1 ? 's' : ''} from job-alert emails.`);
  if (!highlights.length) highlights.push(events.length ? 'Nothing needs your attention.' : `No job-search email in the last ${days} days.`);

  const summary = {
    days,
    since,
    generatedAt: now,
    totalEvents: events.length,
    counts,
    needsAction,
    statusChanges,
    newApplications: newApps.map((a) => ({ id: a.id, company: a.jobListing.company, title: a.jobListing.title, stage: a.stage, createdAt: a.createdAt })),
    jobAlerts: { emails: counts.JOB_ALERT || 0, listingsAdded: jobAlertListings },
    highlights,
    aiSummary: null as string | null,
  };

  if (opts.ai !== false && isGeminiConfigured() && events.length) {
    summary.aiSummary = await aiParaphrase(summary);
  }
  return summary;
}

async function aiParaphrase(s: { highlights: string[]; needsAction: NeedsActionItem[]; statusChanges: { company: string; from: string; to: string }[] }): Promise<string | null> {
  const facts = [
    ...s.highlights,
    ...s.needsAction.slice(0, 10).map((n) => `${n.kind}: ${n.company || 'unknown company'}${n.role ? ` (${n.role})` : ''}${n.deadline ? `, deadline ${n.deadline}` : ''}`),
    ...s.statusChanges.slice(0, 10).map((c) => `${c.company}: ${c.from} → ${c.to}`),
  ].join('\n');
  const key = facts;
  if (aiCache && aiCache.key === key && Date.now() - aiCache.at < 30 * 60 * 1000) return aiCache.text;
  const prompt = [
    'Summarise this job seeker\'s last week of job-search email in 3 to 5 short plain-text bullet lines starting with "- ".',
    'Use only these facts; do not invent companies, dates or numbers. Put what needs action first.',
    facts,
  ].join('\n\n');
  const raw = await generateText(prompt, { temperature: 0.2, minLength: 20, timeoutMs: 15000 });
  if (!raw) return null;
  const lines = toPlainText(raw.replace(/^\s*[-*•]\s*/gm, '- '))
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((l) => (l.startsWith('- ') ? l : `- ${l}`));
  const text = lines.join('\n');
  aiCache = { key, text, at: Date.now() };
  return text;
}
