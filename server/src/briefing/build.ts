/**
 * Builds the structured daily briefing from the database. Read-only: persistence lives in
 * summary.ts. Every "today" means the IST calendar day containing `now`.
 */
import { prisma } from '../db';
import { companyKey as toCompanyKey } from '../lib/company';
import { getActiveProfile } from '../lib/profile';
import { daysAgo, istDateKey, istDayAsUtcMidnight, istEndOfDay, istStartOfDay } from '../lib/time';
import { CLOSED_STATUSES, ContactStatus, DAY_MS } from '../networking/constants';
import { ContactDto, listContacts } from '../networking/contacts';
import { mentionsVit } from '../networking/parse';
import { inShortFor } from './inShort';
import {
  Briefing,
  BriefingCounts,
  BriefingItem,
  BriefingSection,
  BriefingStats,
  BriefingTrigger,
  WeekStats,
} from './types';

export const ACTION_WINDOW_DAYS = 7;
export const STALE_DAYS = 14;
/** An ACCEPTED contact stays "send the ask" for this long, then stops being re-flagged. */
export const ACCEPTED_ASK_WINDOW_DAYS = 14;
const MAX_MATCH_WINDOW_DAYS = 7;

const RESPONSE_CLASSES = ['INTERVIEW_INVITATION', 'ASSESSMENT', 'REJECTION', 'OFFER', 'RECRUITER_OUTREACH', 'REFERRAL_RESPONSE'];
const NOT_DEMO = { isDemo: false } as const;

export interface BuildOptions {
  trigger?: BriefingTrigger;
  /** Ask Gemini for the "In short" line (falls back to rules). */
  useAi?: boolean;
}

/** Inputs to the build that are shared across sections. */
export interface BriefingWindow {
  now: Date;
  dateKey: string;
  dayStart: Date;
  dayEnd: Date;
}

export function briefingWindow(now: Date): BriefingWindow {
  return { now, dateKey: istDateKey(now), dayStart: istStartOfDay(now), dayEnd: istEndOfDay(now) };
}

const fmtStage = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** Pulls deadline wording out of classifier output or the email text. */
export function extractDeadline(...texts: Array<string | null | undefined>): string | null {
  for (const raw of texts) {
    const text = (raw || '').replace(/\s+/g, ' ');
    if (!text) continue;
    const labelled = text.match(/deadline:\s*([^.;\n]{2,60})/i);
    if (labelled) return labelled[1].trim();
    const within = text.match(/\bwithin (?:the next )?\d{1,3} ?(?:hours?|hrs?|days?)\b/i);
    if (within) return within[0];
    const by = text.match(
      /\b(?:by|before|due(?: on| by)?|no later than|expires?(?: on)?)\s+((?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?(\d{1,2}(?:st|nd|rd|th)?\s+[a-z]{3,9}|[a-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|tomorrow|today|tonight|end of (?:day|week))\b[^.;,\n]{0,20}/i
    );
    if (by) return by[0].trim();
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// a. Today's actions
// ---------------------------------------------------------------------------------------------

type EventRow = Awaited<ReturnType<typeof loadRecentEvents>>[number];

async function loadRecentEvents(now: Date) {
  return prisma.emailEvent.findMany({
    where: { ...NOT_DEMO, receivedAt: { gte: daysAgo(ACTION_WINDOW_DAYS, now), lte: now } },
    select: {
      id: true,
      threadId: true,
      subject: true,
      senderName: true,
      sender: true,
      receivedAt: true,
      classification: true,
      importance: true,
      explanation: true,
      suggestedAction: true,
      snippet: true,
      company: true,
      role: true,
      jobApplicationId: true,
      networkingContactId: true,
      jobApplication: { select: { stage: true, jobListing: { select: { title: true, company: true } } } },
    },
    orderBy: { receivedAt: 'desc' },
  });
}

/** Interview/assessment emails that nothing later (another email on the application/thread) has superseded. */
export function openInterviewEvents(events: EventRow[]): EventRow[] {
  const result: EventRow[] = [];
  const seenThreads = new Set<string>();
  for (const e of events) {
    if (e.classification !== 'INTERVIEW_INVITATION' && e.classification !== 'ASSESSMENT') continue;
    if (e.jobApplication && ['REJECTED', 'OFFERED', 'ARCHIVED'].includes(e.jobApplication.stage)) continue;
    // `events` is newest first: anything later on the same application or thread supersedes this one.
    const superseded = events.some(
      (o) =>
        o.id !== e.id &&
        o.receivedAt.getTime() > e.receivedAt.getTime() &&
        ((e.jobApplicationId && o.jobApplicationId === e.jobApplicationId) || (e.threadId && o.threadId === e.threadId))
    );
    if (superseded) continue;
    if (e.threadId) {
      if (seenThreads.has(e.threadId)) continue;
      seenThreads.add(e.threadId);
    }
    result.push(e);
  }
  return result;
}

function eventCompany(e: EventRow): string {
  return e.jobApplication?.jobListing.company || e.company || e.senderName || e.sender;
}

function eventItem(e: EventRow, kind: string, title: string, urgency: BriefingItem['urgency']): BriefingItem {
  const deadline = extractDeadline(e.suggestedAction, e.explanation, e.subject, e.snippet);
  const role = e.jobApplication?.jobListing.title || e.role;
  const detailParts = [role ? `${role} · ` : '', `"${e.subject}"`];
  return {
    key: `${kind}:${e.id}`,
    kind,
    title,
    detail: detailParts.join('') + (e.suggestedAction ? ` — ${e.suggestedAction}` : ''),
    tags: [deadline ? `Deadline: ${deadline}` : null, `Received ${istDateKey(e.receivedAt)}`].filter(Boolean) as string[],
    urgency,
    link: e.jobApplicationId
      ? { tab: 'PIPELINE', id: e.jobApplicationId, label: 'Open application' }
      : { tab: 'GMAIL', id: e.id, label: 'Open email' },
  };
}

function isAcceptedAskStale(c: ContactDto, now: Date): boolean {
  if (c.status !== 'ACCEPTED') return false;
  const since = c.acceptedAt ?? c.nextFollowUpAt ?? c.updatedAt;
  return now.getTime() - since.getTime() > ACCEPTED_ASK_WINDOW_DAYS * DAY_MS;
}

function hasDraft(c: ContactDto): boolean {
  return c.messages.some((m) => m.status === 'DRAFT' || m.status === 'APPROVED');
}

function nextStepText(c: ContactDto): string | null {
  const action = c.nextActions[0];
  if (!action) return null;
  if (action.kind === 'draft') return hasDraft(c) ? 'Send the drafted message' : action.label;
  return `Then mark "${action.label}"`;
}

/** Contacts whose follow-up is due now (closed conversations never are; ACCEPTED only for a while). */
async function dueFollowUps(now: Date): Promise<ContactDto[]> {
  const due = await listContacts({ followUpDue: 'true', sort: 'followUp' }, now);
  return due.filter(
    (c) => c.followUpDue && !CLOSED_STATUSES.includes(c.status as ContactStatus) && !isAcceptedAskStale(c, now)
  );
}

function followUpItem(c: ContactDto): BriefingItem {
  const accepted = c.status === 'ACCEPTED';
  const waiting = c.status === 'REQUEST_SENT';
  const title = accepted
    ? `${c.name} (${c.company}) accepted — send your thank-you and referral ask`
    : waiting
      ? `Check whether ${c.name} (${c.company}) accepted your request`
      : `Follow up with ${c.name} (${c.company})`;
  return {
    key: `followup:${c.id}`,
    kind: 'FOLLOW_UP',
    title,
    detail: [c.role, nextStepText(c)].filter(Boolean).join(' · '),
    tags: [c.vitAlumni || mentionsVit(c.school) ? 'VIT alumni' : null, hasDraft(c) ? 'Draft ready' : null].filter(Boolean) as string[],
    urgency: 'normal',
    link: { tab: 'NETWORKING', id: c.id, label: 'Open contact' },
  };
}

// ---------------------------------------------------------------------------------------------
// b. Networking
// ---------------------------------------------------------------------------------------------

/** Statuses where you're waiting on them and there's nothing to send until a follow-up is due. */
const WAITING = ['REQUEST_SENT', 'MESSAGE_SENT', 'REFERRAL_REQUESTED'];

export function pickPeopleToMessage(contacts: ContactDto[], exclude: Set<string>, limit = 3): ContactDto[] {
  const alumni = (c: ContactDto) => (c.vitAlumni || mentionsVit(c.school) ? 1 : 0);
  return contacts
    .filter((c) => !exclude.has(c.id))
    .filter((c) => !['REFERRED', 'NOT_INTERESTED'].includes(c.status))
    .filter((c) => !(WAITING.includes(c.status) && !c.followUpDue))
    .filter((c) => c.nextActions.length > 0)
    .sort((a, b) => alumni(b) - alumni(a) || b.priority.score - a.priority.score)
    .slice(0, limit);
}

async function networkingSection(now: Date, followUpIds: Set<string>): Promise<BriefingSection> {
  const apps = await prisma.jobApplication.findMany({
    where: { stage: { in: ['APPLIED', 'INTERVIEWING'] } },
    select: { companyKey: true, stage: true, jobListing: { select: { company: true } } },
  });
  const stageByKey = new Map<string, string>();
  for (const a of apps) {
    const key = a.companyKey || toCompanyKey(a.jobListing.company);
    if (!key) continue;
    if (stageByKey.get(key) !== 'INTERVIEWING') stageByKey.set(key, a.stage);
  }
  const keys = [...stageByKey.keys()];
  const contacts = keys.length ? await listContacts({ companyKey: keys.join(','), sort: 'priority' }, now) : [];
  const picks = pickPeopleToMessage(contacts, followUpIds);

  const items: BriefingItem[] = picks.map((c) => {
    const stage = stageByKey.get(c.companyKey);
    const alumni = c.vitAlumni || mentionsVit(c.school);
    return {
      key: `person:${c.id}`,
      kind: 'PERSON',
      title: `${c.name} — ${c.role} at ${c.company}`,
      detail: [stage ? `You're ${stage === 'INTERVIEWING' ? 'interviewing' : 'applied'} here` : null, nextStepText(c)]
        .filter(Boolean)
        .join(' · '),
      tags: [
        alumni ? 'VIT alumni' : null,
        hasDraft(c) ? 'Draft ready' : 'No draft yet',
        `Priority ${c.priority.score}`,
      ].filter(Boolean) as string[],
      urgency: 'normal',
      link: { tab: 'NETWORKING', id: c.id, label: hasDraft(c) ? 'Review draft' : 'Draft message' },
    };
  });

  return {
    key: 'networking',
    title: 'People to message today',
    summary: keys.length
      ? `From ${plural(contacts.length, 'contact')} at ${plural(keys.length, 'company', 'companies')} you've applied to`
      : undefined,
    emptyText: keys.length
      ? 'No one to message at companies you have applied to. Find people at those companies in the Networking tab.'
      : 'No applications in Applied or Interviewing yet.',
    items,
  };
}

// ---------------------------------------------------------------------------------------------
// c. New matches
// ---------------------------------------------------------------------------------------------

/** Start of the new-matches window: the previous briefing, or 24h ago; never older than a week. */
export async function matchesSince(now: Date): Promise<Date> {
  const prev = await prisma.dailyJobSearchSummary.findFirst({
    where: { summaryDate: { lt: istDayAsUtcMidnight(now) } },
    orderBy: { summaryDate: 'desc' },
    select: { generatedAt: true },
  });
  const floor = daysAgo(MAX_MATCH_WINDOW_DAYS, now);
  const since = prev?.generatedAt ?? daysAgo(1, now);
  return since < floor ? floor : since;
}

const NON_INTERN_TYPES = ['FULL_TIME', 'FULLTIME', 'CONTRACT', 'CONTRACTOR', 'PART_TIME', 'PARTTIME', 'TEMPORARY'];

async function matchesSection(now: Date, since: Date, internshipsOnly: boolean): Promise<BriefingSection> {
  const where = {
    isActive: true,
    userStatus: { not: 'DISMISSED' },
    status: { in: ['APPLY', 'REVIEW'] },
    createdAt: { gte: since, lte: now },
    applications: { none: {} },
    // (Spelled out with OR: a NOT over a nullable column drops NULL rows in SQL.)
    ...(internshipsOnly
      ? { OR: [{ isInternship: true }, { employmentType: null }, { employmentType: { notIn: NON_INTERN_TYPES } }] }
      : {}),
  };
  const [jobs, total] = await Promise.all([
    prisma.jobListing.findMany({
      where,
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      take: 5,
      select: { id: true, title: true, company: true, location: true, url: true, score: true, status: true, isInternship: true, bestResumeId: true },
    }),
    prisma.jobListing.count({ where }),
  ]);
  const resumeIds = [...new Set(jobs.map((j) => j.bestResumeId).filter(Boolean))] as string[];
  const resumes = resumeIds.length
    ? await prisma.resume.findMany({ where: { id: { in: resumeIds } }, select: { id: true, label: true } })
    : [];
  const label = new Map(resumes.map((r) => [r.id, r.label]));

  return {
    key: 'matches',
    title: 'New matches',
    summary: total > jobs.length ? `Top ${jobs.length} of ${total} new matches` : undefined,
    emptyText: 'No new matching listings since the last briefing.',
    items: jobs.map((j) => ({
      key: `match:${j.id}`,
      kind: 'MATCH',
      title: `${j.title} at ${j.company}`,
      detail: [j.location, `Match ${j.score}/100`].filter(Boolean).join(' · '),
      tags: [
        j.status === 'APPLY' ? 'Apply' : 'Review',
        j.isInternship ? 'Internship' : null,
        j.bestResumeId && label.get(j.bestResumeId) ? `Use: ${label.get(j.bestResumeId)} resume` : null,
      ].filter(Boolean) as string[],
      urgency: j.status === 'APPLY' ? 'normal' : 'low',
      link: { tab: 'DISCOVERY', id: j.id, label: 'View in Discovery' },
      externalUrl: j.url,
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// d. Pipeline movement
// ---------------------------------------------------------------------------------------------

interface Movement {
  applicationId: string;
  to: string;
  from?: string;
  via: 'manual' | 'email' | 'created' | 'updated';
}

/** Stage changes today from the audit log (manual edits), stage-changing emails, and updatedAt as a last resort. */
async function loadMovements(w: BriefingWindow) {
  const [audits, events, updated, submitted] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        action: { in: ['JOB_APPLICATION_UPDATED', 'JOB_APPLICATION_CREATED', 'APPLICATION_SUBMITTED_WITH_HUMAN_APPROVAL'] },
        timestamp: { gte: w.dayStart, lte: w.dayEnd },
      },
      orderBy: { timestamp: 'asc' },
    }),
    prisma.emailEvent.findMany({
      where: {
        ...NOT_DEMO,
        receivedAt: { gte: w.dayStart, lte: w.dayEnd },
        classification: { in: ['INTERVIEW_INVITATION', 'ASSESSMENT', 'REJECTION', 'OFFER'] },
      },
      select: { id: true, classification: true, jobApplicationId: true, company: true, role: true, subject: true },
    }),
    prisma.jobApplication.findMany({
      where: { updatedAt: { gte: w.dayStart, lte: w.dayEnd }, stage: { in: ['INTERVIEWING', 'OFFERED', 'REJECTED'] } },
      select: { id: true, stage: true },
    }),
    prisma.jobApplication.findMany({
      where: { submittedAt: { gte: w.dayStart, lte: w.dayEnd } },
      select: { id: true, stage: true, source: true, jobListing: { select: { title: true, company: true } } },
      orderBy: { submittedAt: 'asc' },
    }),
  ]);

  const moves = new Map<string, Movement>();
  for (const a of audits) {
    const meta = (a.metadata ?? {}) as Record<string, any>;
    if (a.action === 'JOB_APPLICATION_UPDATED') {
      const to = meta?.changes?.stage;
      const from = meta?.from?.stage;
      if (typeof to === 'string' && to !== from) {
        const prev = moves.get(a.entityId);
        moves.set(a.entityId, { applicationId: a.entityId, to, from: prev?.from ?? from, via: 'manual' });
      }
    } else if (a.action === 'APPLICATION_SUBMITTED_WITH_HUMAN_APPROVAL') {
      const prev = moves.get(a.entityId);
      moves.set(a.entityId, { applicationId: a.entityId, to: 'APPLIED', from: prev?.from, via: 'manual' });
    } else if (typeof meta?.stage === 'string' && !moves.has(a.entityId)) {
      moves.set(a.entityId, { applicationId: a.entityId, to: meta.stage, via: 'created' });
    }
  }
  const emailStage: Record<string, string> = {
    INTERVIEW_INVITATION: 'INTERVIEWING',
    ASSESSMENT: 'INTERVIEWING',
    REJECTION: 'REJECTED',
    OFFER: 'OFFERED',
  };
  for (const e of events) {
    if (!e.jobApplicationId || moves.has(e.jobApplicationId)) continue;
    moves.set(e.jobApplicationId, { applicationId: e.jobApplicationId, to: emailStage[e.classification], via: 'email' });
  }
  for (const u of updated) {
    if (!moves.has(u.id)) moves.set(u.id, { applicationId: u.id, to: u.stage, via: 'updated' });
  }
  return { moves: [...moves.values()], events, submitted };
}

async function movementSection(w: BriefingWindow) {
  const { moves, events, submitted } = await loadMovements(w);
  const submittedIds = new Set(submitted.map((s) => s.id));
  // New applications are listed on their own; don't repeat "→ Applied" for them.
  const stageMoves = moves.filter((m) => !(m.to === 'APPLIED' && submittedIds.has(m.applicationId)) && m.to !== 'BOOKMARKED');
  const apps = stageMoves.length
    ? await prisma.jobApplication.findMany({
        where: { id: { in: stageMoves.map((m) => m.applicationId) } },
        select: { id: true, stage: true, jobListing: { select: { title: true, company: true } } },
      })
    : [];
  const byId = new Map(apps.map((a) => [a.id, a]));

  const items: BriefingItem[] = [];
  for (const m of stageMoves) {
    const app = byId.get(m.applicationId);
    if (!app) continue; // deleted since
    const viaText = { manual: 'you updated it', email: 'from an email', created: 'added today', updated: 'updated today' }[m.via];
    items.push({
      key: `move:${m.applicationId}`,
      kind: m.to === 'REJECTED' ? 'REJECTION' : m.to === 'OFFERED' ? 'OFFER' : 'STAGE_CHANGE',
      title: `${app.jobListing.title} at ${app.jobListing.company}: ${m.from ? `${fmtStage(m.from)} → ` : ''}${fmtStage(app.stage)}`,
      detail: viaText,
      urgency: m.to === 'OFFERED' ? 'high' : 'normal',
      link: { tab: 'PIPELINE', id: m.applicationId, label: 'Open application' },
    });
  }
  for (const s of submitted) {
    items.push({
      key: `applied:${s.id}`,
      kind: 'NEW_APPLICATION',
      title: `Applied: ${s.jobListing.title} at ${s.jobListing.company}`,
      detail: s.source ? `via ${s.source}` : undefined,
      urgency: 'low',
      link: { tab: 'PIPELINE', id: s.id, label: 'Open application' },
    });
  }
  // Rejection/offer emails today that aren't linked to an application still belong here.
  for (const e of events) {
    if (e.jobApplicationId || (e.classification !== 'REJECTION' && e.classification !== 'OFFER')) continue;
    items.push({
      key: `email:${e.id}`,
      kind: e.classification,
      title: `${e.classification === 'OFFER' ? 'Offer' : 'Rejection'}: ${[e.role, e.company].filter(Boolean).join(' at ') || e.subject}`,
      detail: 'Email not linked to an application',
      urgency: e.classification === 'OFFER' ? 'high' : 'normal',
      link: { tab: 'GMAIL', id: e.id, label: 'Open email' },
    });
  }

  // Counts (distinct by application, or by email when unlinked).
  const distinct = (pred: (to: string) => boolean, cls: string[]) => {
    const keys = new Set<string>();
    for (const m of moves) if (pred(m.to) && byId.has(m.applicationId)) keys.add(m.applicationId);
    for (const e of events) if (cls.includes(e.classification)) keys.add(e.jobApplicationId || `email:${e.id}`);
    return keys.size;
  };
  const counts = {
    newApplicationsCount: submitted.length,
    interviewsCount: distinct((to) => to === 'INTERVIEWING', ['INTERVIEW_INVITATION', 'ASSESSMENT']),
    rejectionsCount: distinct((to) => to === 'REJECTED', ['REJECTION']),
    offersCount: distinct((to) => to === 'OFFERED', ['OFFER']),
  };

  const section: BriefingSection = {
    key: 'movement',
    title: 'Pipeline movement today',
    summary:
      items.length > 0
        ? [
            plural(counts.newApplicationsCount, 'new application'),
            plural(counts.interviewsCount, 'interview'),
            plural(counts.rejectionsCount, 'rejection'),
            plural(counts.offersCount, 'offer'),
          ].join(' · ')
        : undefined,
    emptyText: 'No stage changes or new applications today.',
    items,
  };
  return { section, counts };
}

// ---------------------------------------------------------------------------------------------
// e. Wellfound
// ---------------------------------------------------------------------------------------------

async function wellfoundSection(w: BriefingWindow): Promise<BriefingSection> {
  const runs = await prisma.wellfoundRun.findMany({
    where: { startedAt: { gte: w.dayStart, lte: w.dayEnd } },
    orderBy: { startedAt: 'asc' },
  });
  const submitted = runs.filter((r) => r.mode === 'LIVE').reduce((s, r) => s + r.submittedCount, 0);
  const failed = runs.filter((r) => r.status === 'FAILED' || r.errorCount > 0);
  const time = (d: Date) =>
    d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

  return {
    key: 'wellfound',
    title: 'Wellfound auto-apply',
    summary: runs.length
      ? `${plural(runs.length, 'run')} · ${submitted} submitted (live) · ${plural(failed.length, 'run')} with problems`
      : undefined,
    emptyText: 'No Wellfound runs today.',
    items: runs.map((r) => {
      const bad = r.status === 'FAILED' || r.errorCount > 0;
      return {
        key: `wellfound:${r.id}`,
        kind: 'WELLFOUND_RUN',
        title: `${r.mode === 'LIVE' ? 'Live' : 'Dry'} run at ${time(r.startedAt)}: ${fmtStage(r.status)}`,
        detail: [
          `${r.submittedCount} ${r.mode === 'LIVE' ? 'submitted' : 'would submit'}`,
          `${r.skippedCount} skipped`,
          `${r.errorCount} errors`,
          bad && r.error ? r.error.slice(0, 160) : null,
        ]
          .filter(Boolean)
          .join(' · '),
        tags: bad && r.diagnosticsDir ? ['Diagnostics saved'] : undefined,
        urgency: bad ? 'high' : 'low',
        link: { tab: 'WELLFOUND', id: r.id, label: bad ? 'Open run diagnostics' : 'Open run' },
      } satisfies BriefingItem;
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// f. Stale applications
// ---------------------------------------------------------------------------------------------

async function staleSection(now: Date): Promise<BriefingSection> {
  const cutoff = daysAgo(STALE_DAYS, now);
  const candidates = await prisma.jobApplication.findMany({
    where: {
      stage: 'APPLIED',
      OR: [{ submittedAt: { lte: cutoff } }, { submittedAt: null, createdAt: { lte: cutoff } }],
      AND: [
        { OR: [{ lastEmailAt: null }, { lastEmailAt: { lte: cutoff } }] },
        { emailEvents: { none: { receivedAt: { gt: cutoff }, isDemo: false } } },
      ],
    },
    select: {
      id: true,
      companyKey: true,
      submittedAt: true,
      createdAt: true,
      jobListing: { select: { title: true, company: true } },
    },
    orderBy: [{ submittedAt: 'asc' }, { createdAt: 'asc' }],
  });
  // A stage change in the window (audit log) also means it's not stale.
  const recentChanges = candidates.length
    ? await prisma.auditLog.findMany({
        where: { action: 'JOB_APPLICATION_UPDATED', entityId: { in: candidates.map((c) => c.id) }, timestamp: { gt: cutoff } },
        select: { entityId: true, metadata: true },
      })
    : [];
  const changed = new Set(
    recentChanges.filter((a) => typeof (a.metadata as any)?.changes?.stage === 'string').map((a) => a.entityId)
  );
  const stale = candidates.filter((c) => !changed.has(c.id));
  const shown = stale.slice(0, 5);

  const keys = [...new Set(shown.map((s) => s.companyKey || toCompanyKey(s.jobListing.company)).filter(Boolean))];
  const people = keys.length
    ? await prisma.networkingContact.groupBy({
        by: ['companyKey'],
        where: { companyKey: { in: keys }, status: { notIn: ['NOT_INTERESTED'] } },
        _count: { _all: true },
      })
    : [];
  const peopleBy = new Map(people.map((p) => [p.companyKey, p._count._all]));

  return {
    key: 'stale',
    title: 'Stale applications',
    summary: stale.length > shown.length ? `Oldest ${shown.length} of ${stale.length}` : undefined,
    emptyText: `Nothing has been waiting ${STALE_DAYS}+ days without a response.`,
    items: shown.map((s) => {
      const key = s.companyKey || toCompanyKey(s.jobListing.company);
      const count = peopleBy.get(key) ?? 0;
      const days = Math.floor((now.getTime() - (s.submittedAt ?? s.createdAt).getTime()) / DAY_MS);
      return {
        key: `stale:${s.id}`,
        kind: 'STALE',
        title: `${s.jobListing.title} at ${s.jobListing.company} — ${days} days, no response`,
        detail:
          count > 0
            ? `Message one of the ${plural(count, 'person', 'people')} you know at ${s.jobListing.company}, or send a follow-up.`
            : `No contacts at ${s.jobListing.company} yet: find someone to ask, or send a short follow-up.`,
        tags: [plural(count, 'contact')],
        urgency: 'low',
        link:
          count > 0
            ? { tab: 'NETWORKING', params: { companyKey: key }, label: `See people at ${s.jobListing.company}` }
            : { tab: 'PIPELINE', id: s.id, label: 'Open application' },
      } satisfies BriefingItem;
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// g. Stats
// ---------------------------------------------------------------------------------------------

async function weekStats(from: Date, to: Date): Promise<WeekStats> {
  const range = { gte: from, lte: to };
  const [applications, responses, interviews, sentMessages, requests] = await Promise.all([
    prisma.jobApplication.count({ where: { submittedAt: range } }),
    prisma.emailEvent.count({ where: { ...NOT_DEMO, receivedAt: range, classification: { in: RESPONSE_CLASSES } } }),
    prisma.emailEvent.count({ where: { ...NOT_DEMO, receivedAt: range, classification: 'INTERVIEW_INVITATION' } }),
    prisma.networkingMessage.findMany({ where: { status: 'SENT', sentAt: range }, select: { contactId: true } }),
    prisma.networkingContact.findMany({ where: { requestSentAt: range }, select: { id: true } }),
  ]);
  const messaged = new Set([...sentMessages.map((m) => m.contactId), ...requests.map((r) => r.id)]);
  return { applications, responses, interviews, contactsMessaged: messaged.size };
}

async function statsFor(w: BriefingWindow): Promise<BriefingStats> {
  // This week = today and the 6 IST days before it; last week = the 7 days before that.
  const thisFrom = new Date(w.dayStart.getTime() - 6 * DAY_MS);
  const lastFrom = new Date(thisFrom.getTime() - 7 * DAY_MS);
  const lastTo = new Date(thisFrom.getTime() - 1);
  const [thisWeek, lastWeek] = await Promise.all([weekStats(thisFrom, w.dayEnd), weekStats(lastFrom, lastTo)]);
  return {
    thisWeek,
    lastWeek,
    thisWeekRange: { from: istDateKey(thisFrom), to: w.dateKey },
    lastWeekRange: { from: istDateKey(lastFrom), to: istDateKey(lastTo) },
  };
}

// ---------------------------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------------------------

async function acceptedConnectionsToday(w: BriefingWindow): Promise<number> {
  const [contacts, events] = await Promise.all([
    prisma.networkingContact.findMany({ where: { acceptedAt: { gte: w.dayStart, lte: w.dayEnd } }, select: { id: true } }),
    prisma.emailEvent.findMany({
      where: { ...NOT_DEMO, classification: 'LINKEDIN_CONNECTION_ACCEPTED', receivedAt: { gte: w.dayStart, lte: w.dayEnd } },
      select: { id: true, networkingContactId: true },
    }),
  ]);
  const ids = new Set(contacts.map((c) => c.id));
  for (const e of events) ids.add(e.networkingContactId || `email:${e.id}`);
  return ids.size;
}

function actionsSection(events: EventRow[], followUps: ContactDto[]): { section: BriefingSection; offers: number } {
  const items: BriefingItem[] = [];
  const offers = events.filter((e) => e.classification === 'OFFER' && e.jobApplication?.stage !== 'REJECTED');
  for (const e of offers) items.push(eventItem(e, 'OFFER', `Offer from ${eventCompany(e)} — review and respond`, 'high'));
  for (const e of openInterviewEvents(events)) {
    const label = e.classification === 'ASSESSMENT' ? 'Complete the assessment for' : 'Schedule your interview with';
    items.push(eventItem(e, e.classification, `${label} ${eventCompany(e)}`, 'high'));
  }
  const replies = events.filter((e) => e.classification === 'RECRUITER_OUTREACH' || e.classification === 'REFERRAL_RESPONSE');
  for (const e of replies) {
    const who = e.senderName || e.sender;
    const title =
      e.classification === 'REFERRAL_RESPONSE'
        ? `Reply to ${who} about your referral (${eventCompany(e)})`
        : `Reply to recruiter ${who} (${eventCompany(e)})`;
    const item = eventItem(e, e.classification, title, 'normal');
    if (e.networkingContactId && !e.jobApplicationId) item.link = { tab: 'NETWORKING', id: e.networkingContactId, label: 'Open contact' };
    items.push(item);
  }
  for (const c of followUps.slice(0, 5)) items.push(followUpItem(c));

  return {
    section: {
      key: 'actions',
      title: "Today's actions",
      summary: followUps.length > 5 ? `${followUps.length} follow-ups due; showing the 5 most overdue` : undefined,
      emptyText: 'Nothing urgent: no open interviews, assessments, recruiter replies or follow-ups due.',
      items,
    },
    offers: offers.length,
  };
}

export async function buildBriefing(now: Date = new Date(), opts: BuildOptions = {}): Promise<Briefing> {
  const w = briefingWindow(now);
  const profile = await getActiveProfile();
  const internshipsOnly = /\bintern/i.test(profile?.targetRole || '');
  const since = await matchesSince(now);

  const [events, followUps, accepted] = await Promise.all([loadRecentEvents(now), dueFollowUps(now), acceptedConnectionsToday(w)]);
  const actions = actionsSection(events, followUps);
  const followUpIds = new Set(followUps.map((c) => c.id));

  const [networking, matches, movement, wellfound, stale, stats] = await Promise.all([
    networkingSection(now, followUpIds),
    matchesSection(now, since, internshipsOnly),
    movementSection(w),
    wellfoundSection(w),
    staleSection(now),
    statsFor(w),
  ]);

  const counts: BriefingCounts = {
    newApplicationsCount: movement.counts.newApplicationsCount,
    interviewsCount: movement.counts.interviewsCount,
    rejectionsCount: movement.counts.rejectionsCount,
    offersCount: movement.counts.offersCount,
    acceptedConnectionsCount: accepted,
    needsAttentionCount: actions.section.items.length,
    newMatchesCount: matches.items.length,
    staleCount: stale.items.length,
    wellfoundRunsCount: wellfound.items.length,
  };

  const name = profile?.name?.trim();
  const briefing: Briefing = {
    version: 1,
    date: w.dateKey,
    generatedAt: now.toISOString(),
    trigger: opts.trigger ?? 'manual',
    candidateName: name && name !== 'Your Name' ? name : null,
    inShort: { text: '', source: 'rules' },
    counts,
    matchesSince: since.toISOString(),
    sections: [actions.section, networking, matches, movement.section, wellfound, stale],
    stats,
  };

  briefing.inShort = await inShortFor(briefing, { useAi: opts.useAi ?? false });
  return briefing;
}
