/**
 * Referral priority (0–100): how worthwhile it is to message this person next, following
 * docs/NETWORKING_PLAYBOOK.md — alumni and engineers first, recruiters moderate, founders
 * modest (no reliable company-size data), boosted when you're actually in that company's
 * pipeline. Computed on every read so it tracks application/job changes.
 */
import { prisma } from '../db';
import { DAY_MS, FOLLOW_UP_MIN_DAYS } from './constants';
import { mentionsVit } from './parse';

export interface PriorityItem {
  label: string;
  points: number;
}

export interface Priority {
  score: number;
  breakdown: PriorityItem[];
}

export interface PriorityCompanyInfo {
  /** Highest application stage at this company, if any. */
  applicationStage: string | null;
  /** Active listings at the company first seen/published in the last 30 days. */
  recentJobCount: number;
}

export interface PriorityContact {
  vitAlumni: boolean;
  school: string | null;
  persona: string;
  status: string;
  linkedinUrl: string | null;
  xUrl: string | null;
  email: string | null;
  lastContactAt: Date | null;
  messages?: { type: string; status: string; sentAt: Date | null }[];
}

const STAGE_RANK: Record<string, number> = { BOOKMARKED: 1, APPLYING: 2, APPLIED: 3, INTERVIEWING: 4, OFFERED: 5 };

/** True when the user already followed up once and nothing came back after FOLLOW_UP_MIN_DAYS. */
export function isNoReply(contact: PriorityContact, now = new Date()): boolean {
  if (['REPLIED', 'REFERRED', 'NOT_INTERESTED'].includes(contact.status)) return false;
  const followUp = (contact.messages || [])
    .filter((m) => (m.type === 'FOLLOW_UP' || m.type === 'FOLLOWUP_REMINDER') && m.status === 'SENT' && m.sentAt)
    .sort((a, b) => b.sentAt!.getTime() - a.sentAt!.getTime())[0];
  return Boolean(followUp && now.getTime() - followUp.sentAt!.getTime() >= FOLLOW_UP_MIN_DAYS * DAY_MS);
}

export function computePriority(contact: PriorityContact, company: PriorityCompanyInfo | undefined, now = new Date()): Priority {
  const breakdown: PriorityItem[] = [{ label: 'Base', points: 10 }];
  const add = (label: string, points: number) => breakdown.push({ label, points });

  if (contact.vitAlumni || mentionsVit(contact.school)) add('VIT alumni (warmest cold contact)', 30);

  switch (contact.persona) {
    case 'ENGINEER':
      add('Engineer: can refer you to their team', 20);
      break;
    case 'FULLSTACK':
      add('Full-stack engineer: relevant team', 20);
      break;
    case 'MANAGER':
      add('Engineering manager: hiring influence', 12);
      break;
    case 'RECRUITER':
      add('Recruiter: moderate reply rate', 10);
      break;
    case 'FOUNDER_CXO':
      add('Founder/CXO: strong at small startups (company size unknown)', 10);
      break;
    default:
      break;
  }

  const stage = company?.applicationStage;
  if (stage === 'APPLIED' || stage === 'INTERVIEWING' || stage === 'OFFERED') add(`You've applied here (${stage.toLowerCase()})`, 15);
  else if (stage === 'BOOKMARKED' || stage === 'APPLYING') add('Company is in your pipeline', 5);

  if (company && company.recentJobCount > 0) add('Company posted a role in the last 30 days', 10);

  if (contact.linkedinUrl || contact.xUrl || contact.email) add('Has a way to reach them', 5);
  else add('No LinkedIn, X or email yet', -5);

  if (isNoReply(contact, now)) add('No reply after your follow-up', -25);
  if (contact.status === 'NOT_INTERESTED') add('Marked not interested', -50);
  if (contact.status === 'REFERRED') add('Already referred you', -15);

  const total = breakdown.reduce((s, b) => s + b.points, 0);
  return { score: Math.max(0, Math.min(100, total)), breakdown };
}

/** Loads application stage and recent-job counts for the given company keys in two queries. */
export async function loadCompanyInfo(keys: string[], now = new Date()): Promise<Map<string, PriorityCompanyInfo>> {
  const unique = [...new Set(keys.filter(Boolean))];
  const map = new Map<string, PriorityCompanyInfo>();
  if (!unique.length) return map;
  for (const k of unique) map.set(k, { applicationStage: null, recentJobCount: 0 });

  const apps = await prisma.jobApplication.findMany({
    where: { companyKey: { in: unique } },
    select: { companyKey: true, stage: true },
  });
  for (const a of apps) {
    const info = map.get(a.companyKey)!;
    if ((STAGE_RANK[a.stage] ?? 0) > (STAGE_RANK[info.applicationStage || ''] ?? 0)) info.applicationStage = a.stage;
  }

  const since = new Date(now.getTime() - 30 * DAY_MS);
  const jobs = await prisma.jobListing.groupBy({
    by: ['companyKey'],
    where: {
      companyKey: { in: unique },
      isActive: true,
      userStatus: { not: 'DISMISSED' },
      OR: [{ publishedAt: { gte: since } }, { publishedAt: null, createdAt: { gte: since } }],
    },
    _count: { _all: true },
  });
  for (const j of jobs) map.get(j.companyKey)!.recentJobCount = j._count._all;
  return map;
}
