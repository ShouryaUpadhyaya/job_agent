/**
 * Read model for the Application Pipeline: filters, sorting, per-company people counts
 * (one batched query for the whole list) and the composite fit score.
 *
 * Never returns the candidate profile, raw resume or document contents.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { companyKey as toCompanyKey } from '../lib/company';
import { STAGES, isStage } from '../lib/stages';
import { contactsByCompany } from '../networking/contacts';
import { CLOSED_STAGES, FitResult, computeFit } from './fit';

export const APPLICATION_SORTS = ['fit', 'match', 'alumni', 'recent', 'applied', 'company'] as const;
export type ApplicationSort = (typeof APPLICATION_SORTS)[number];

export const APPLICATION_SOURCES = ['manual', 'wellfound', 'email', 'import'] as const;

/** Contact statuses that mean a conversation has actually started. */
const ENGAGED_STATUSES = ['ACCEPTED', 'MESSAGE_SENT', 'REPLIED', 'REFERRAL_REQUESTED', 'REFERRED'];

const JOB_SELECT = {
  id: true,
  title: true,
  company: true,
  location: true,
  url: true,
  source: true,
  score: true,
  status: true,
  matchReasons: true,
  matchedSkills: true,
  missingSkills: true,
  isActive: true,
  closedReason: true,
  closedAt: true,
  bestResumeId: true,
  publishedAt: true,
  createdAt: true,
} satisfies Prisma.JobListingSelect;

export const APPLICATION_SELECT = {
  id: true,
  jobListingId: true,
  stage: true,
  status: true,
  isApproved: true,
  notes: true,
  appliedUrl: true,
  submittedAt: true,
  createdAt: true,
  updatedAt: true,
  lastEmailAt: true,
  source: true,
  companyKey: true,
  jobListing: { select: JOB_SELECT },
  _count: { select: { documents: true, emailEvents: true } },
} satisfies Prisma.JobApplicationSelect;

type ApplicationRow = Prisma.JobApplicationGetPayload<{ select: typeof APPLICATION_SELECT }>;

export interface PeopleInfo {
  count: number;
  alumniCount: number;
  engagedCount: number;
  topContacts: unknown[];
}

export interface ApplicationDto {
  id: string;
  jobListingId: string;
  stage: string;
  status: string;
  isApproved: boolean;
  notes: string | null;
  appliedUrl: string | null;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastEmailAt: Date | null;
  source: string | null;
  companyKey: string;
  documentCount: number;
  emailCount: number;
  job: ApplicationRow['jobListing'];
  people: PeopleInfo;
  fit: FitResult;
}

export interface ApplicationQuery {
  stage?: unknown;
  status?: unknown;
  q?: unknown;
  source?: unknown;
  hasAlumni?: unknown;
  sort?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : Array.isArray(v) ? String(v[0] ?? '').trim() : '');
const csv = (v: unknown): string[] =>
  str(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const truthy = (v: unknown) => ['1', 'true', 'yes'].includes(str(v).toLowerCase());

export function appCompanyKey(row: { companyKey: string; jobListing: { company: string } }): string {
  return row.companyKey || toCompanyKey(row.jobListing.company);
}

/** People per company key: counts and top contacts (batched) plus engaged-contact counts. */
async function loadPeople(keys: string[]): Promise<Record<string, PeopleInfo>> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (!unique.length) return {};
  // contactsByCompany caps one call at 200 keys.
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 200) chunks.push(unique.slice(i, i + 200));
  const [parts, engaged] = await Promise.all([
    Promise.all(chunks.map((c) => contactsByCompany(c))),
    prisma.networkingContact.groupBy({
      by: ['companyKey'],
      where: { companyKey: { in: unique }, status: { in: ENGAGED_STATUSES } },
      _count: { _all: true },
    }),
  ]);
  const byCompany = Object.assign({}, ...parts) as Awaited<ReturnType<typeof contactsByCompany>>;
  const engagedBy = new Map(engaged.map((g) => [g.companyKey, g._count._all]));
  const out: Record<string, PeopleInfo> = {};
  for (const [key, v] of Object.entries(byCompany)) {
    out[key] = { ...v, engagedCount: engagedBy.get(key) ?? 0 };
  }
  return out;
}

const EMPTY_PEOPLE: PeopleInfo = { count: 0, alumniCount: 0, engagedCount: 0, topContacts: [] };

export async function toApplicationDtos(rows: ApplicationRow[], now = new Date()): Promise<ApplicationDto[]> {
  const people = await loadPeople(rows.map(appCompanyKey));
  return rows.map((row) => {
    const key = appCompanyKey(row);
    const p = people[key] ?? EMPTY_PEOPLE;
    const job = row.jobListing;
    const fit = computeFit({
      matchScore: job.score,
      alumniCount: p.alumniCount,
      contactCount: p.count,
      engagedCount: p.engagedCount,
      listingActive: job.isActive,
      listedAt: job.publishedAt ?? job.createdAt,
      stage: row.stage,
      lastEmailAt: row.lastEmailAt,
      now,
    });
    const { _count, jobListing, ...rest } = row;
    return {
      ...rest,
      companyKey: key,
      documentCount: _count.documents,
      emailCount: _count.emailEvents,
      job: jobListing,
      people: p,
      fit,
    };
  });
}

export async function getApplicationDto(id: string): Promise<ApplicationDto | null> {
  const row = await prisma.jobApplication.findUnique({ where: { id }, select: APPLICATION_SELECT });
  if (!row) return null;
  return (await toApplicationDtos([row]))[0];
}

const time = (d: Date | null | undefined) => (d ? new Date(d).getTime() : 0);
const closedRank = (a: ApplicationDto) => (CLOSED_STAGES.includes(a.stage) ? 1 : 0);

export function sortApplications(list: ApplicationDto[], sort: ApplicationSort): ApplicationDto[] {
  const byMatch = (a: ApplicationDto, b: ApplicationDto) => b.job.score - a.job.score;
  const byFit = (a: ApplicationDto, b: ApplicationDto) => b.fit.score - a.fit.score;
  const byRecent = (a: ApplicationDto, b: ApplicationDto) => time(b.updatedAt) - time(a.updatedAt);
  const stable = (a: ApplicationDto, b: ApplicationDto) => time(b.createdAt) - time(a.createdAt) || a.id.localeCompare(b.id);

  const cmp: Record<ApplicationSort, (a: ApplicationDto, b: ApplicationDto) => number> = {
    // Ranking sorts sink rejected/archived applications to the bottom.
    fit: (a, b) => closedRank(a) - closedRank(b) || byFit(a, b) || byMatch(a, b),
    match: (a, b) => closedRank(a) - closedRank(b) || byMatch(a, b) || byFit(a, b),
    alumni: (a, b) =>
      closedRank(a) - closedRank(b) || b.people.alumniCount - a.people.alumniCount || byMatch(a, b) || byFit(a, b),
    recent: byRecent,
    applied: (a, b) => {
      if (!a.submittedAt !== !b.submittedAt) return a.submittedAt ? -1 : 1;
      return time(b.submittedAt) - time(a.submittedAt) || byRecent(a, b);
    },
    company: (a, b) =>
      a.job.company.localeCompare(b.job.company, undefined, { sensitivity: 'base' }) ||
      a.job.title.localeCompare(b.job.title, undefined, { sensitivity: 'base' }),
  };
  return [...list].sort((a, b) => cmp[sort](a, b) || stable(a, b));
}

export function parseSort(v: unknown): ApplicationSort {
  const s = str(v);
  return (APPLICATION_SORTS as readonly string[]).includes(s) ? (s as ApplicationSort) : 'fit';
}

export function buildWhere(query: ApplicationQuery): Prisma.JobApplicationWhereInput {
  const and: Prisma.JobApplicationWhereInput[] = [];
  const stages = csv(query.stage);
  if (stages.length) and.push({ stage: { in: stages } });
  const statuses = csv(query.status);
  if (statuses.length) and.push({ status: { in: statuses } });
  const sources = csv(query.source);
  if (sources.length) {
    // Rows created before `source` existed have it null; treat them as manual.
    const or: Prisma.JobApplicationWhereInput[] = [{ source: { in: sources } }];
    if (sources.includes('manual')) or.push({ source: null });
    and.push({ OR: or });
  }
  const q = str(query.q).slice(0, 200);
  if (q) {
    const contains = { contains: q, mode: 'insensitive' as const };
    and.push({
      OR: [{ notes: contains }, { jobListing: { title: contains } }, { jobListing: { company: contains } }],
    });
  }
  return and.length ? { AND: and } : {};
}

export async function listApplications(query: ApplicationQuery, now = new Date()): Promise<ApplicationDto[]> {
  const rows = await prisma.jobApplication.findMany({ where: buildWhere(query), select: APPLICATION_SELECT });
  let dtos = await toApplicationDtos(rows, now);
  if (truthy(query.hasAlumni)) dtos = dtos.filter((d) => d.people.alumniCount > 0);
  return sortApplications(dtos, parseSort(query.sort));
}

export async function applicationStats() {
  const [byStage, bySource] = await Promise.all([
    prisma.jobApplication.groupBy({ by: ['stage'], _count: { _all: true } }),
    prisma.jobApplication.groupBy({ by: ['source'], _count: { _all: true } }),
  ]);
  const stages: Record<string, number> = Object.fromEntries(STAGES.map((s) => [s, 0]));
  let other = 0;
  let total = 0;
  for (const g of byStage) {
    total += g._count._all;
    if (isStage(g.stage)) stages[g.stage] = g._count._all;
    else other += g._count._all;
  }
  const sources: Record<string, number> = {};
  for (const g of bySource) {
    const k = g.source || 'manual';
    sources[k] = (sources[k] ?? 0) + g._count._all;
  }
  return { total, stages, other, sources };
}
