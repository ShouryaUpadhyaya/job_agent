import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { getActiveProfile } from '../lib/profile';
import { daysAgo } from '../lib/time';

export const overviewRouter = Router();

/** Applications that reached the applied stage at some point. */
const APPLIED_STAGES = ['APPLIED', 'INTERVIEWING', 'OFFERED', 'REJECTED'];
/** Email classifications that count as a company responding. */
const RESPONSE_CLASSES = ['INTERVIEW_INVITATION', 'ASSESSMENT', 'REJECTION', 'OFFER'];

function postedSince(date: Date): Prisma.JobListingWhereInput {
  return { OR: [{ publishedAt: { gte: date } }, { publishedAt: null, createdAt: { gte: date } }] };
}

function toRecord<T extends { _count: { _all: number } }>(rows: T[], key: keyof T): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[String(row[key] ?? 'UNKNOWN')] = row._count._all;
  return out;
}

export async function buildOverview(now = new Date()) {
  const active: Prisma.JobListingWhereInput = { isActive: true };
  const d3 = daysAgo(3, now);
  const d7 = daysAgo(7, now);
  const d30 = daysAgo(30, now);
  const appliedWhere: Prisma.JobApplicationWhereInput = {
    OR: [{ submittedAt: { not: null } }, { stage: { in: APPLIED_STAGES } }],
  };

  const [
    activeTotal, bySource, byStatus, internships, saved,
    within3, within7, within30,
    stages, newThisWeek, applied, responded,
    contactStatuses, alumni, contactsTotal,
    lastSyncs, failures24h,
    gmail, wellfound, profile,
  ] = await Promise.all([
    prisma.jobListing.count({ where: active }),
    prisma.jobListing.groupBy({ by: ['source'], where: active, _count: { _all: true } }),
    prisma.jobListing.groupBy({ by: ['status'], where: active, _count: { _all: true } }),
    prisma.jobListing.count({ where: { ...active, isInternship: true } }),
    prisma.jobListing.count({ where: { ...active, userStatus: 'SAVED' } }),
    prisma.jobListing.count({ where: { AND: [active, postedSince(d3)] } }),
    prisma.jobListing.count({ where: { AND: [active, postedSince(d7)] } }),
    prisma.jobListing.count({ where: { AND: [active, postedSince(d30)] } }),
    prisma.jobApplication.groupBy({ by: ['stage'], _count: { _all: true } }),
    prisma.jobApplication.count({ where: { submittedAt: { gte: d7 } } }),
    prisma.jobApplication.count({ where: appliedWhere }),
    prisma.jobApplication.count({
      where: { AND: [appliedWhere, { emailEvents: { some: { classification: { in: RESPONSE_CLASSES }, isDemo: false } } }] },
    }),
    prisma.networkingContact.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.networkingContact.count({
      where: { OR: [{ school: { contains: 'VIT' } }, { school: { contains: 'Vellore Institute', mode: 'insensitive' } }] },
    }),
    prisma.networkingContact.count(),
    prisma.$queryRaw<{ source: string; status: string; startedAt: Date; completedAt: Date | null; fetchedCount: number; newCount: number; errorMessage: string | null }[]>`
      SELECT DISTINCT ON ("source") "source", "status", "startedAt", "completedAt", "fetchedCount", "newCount", "errorMessage"
      FROM "SyncRun" ORDER BY "source", "startedAt" DESC`,
    prisma.syncRun.groupBy({
      by: ['source'],
      where: { status: 'FAILED', startedAt: { gte: daysAgo(1, now) } },
      _count: { _all: true },
    }),
    prisma.connectedAccount.findFirst({
      where: { provider: 'gmail' },
      orderBy: { updatedAt: 'desc' },
      select: { email: true, status: true, lastSyncedAt: true },
    }),
    prisma.wellfoundRun.findFirst({
      orderBy: { startedAt: 'desc' },
      select: { id: true, mode: true, status: true, startedAt: true, endedAt: true, submittedCount: true, skippedCount: true, errorCount: true, error: true },
    }),
    getActiveProfile(),
  ]);

  const resumes = profile
    ? await prisma.resume.findMany({ where: { candidateProfileId: profile.id }, select: { label: true, isDefault: true } })
    : [];
  const failures = toRecord(failures24h, 'source');
  const statusCounts = toRecord(byStatus, 'status');

  return {
    generatedAt: now.toISOString(),
    jobs: {
      active: activeTotal,
      bySource: toRecord(bySource, 'source'),
      freshness: {
        within3d: within3,
        within7d: within7 - within3,
        within30d: within30 - within7,
        older: activeTotal - within30,
      },
      internships,
      saved,
      apply: statusCounts.APPLY ?? 0,
      review: statusCounts.REVIEW ?? 0,
    },
    applications: {
      total: stages.reduce((n, s) => n + s._count._all, 0),
      byStage: toRecord(stages, 'stage'),
      newThisWeek,
      applied,
      responded,
      responseRate: applied ? Math.round((responded / applied) * 1000) / 1000 : null,
    },
    contacts: {
      total: contactsTotal,
      byStatus: toRecord(contactStatuses, 'status'),
      vitAlumni: alumni,
    },
    sync: {
      sources: lastSyncs.map((r) => ({ ...r, failuresLast24h: failures[r.source] ?? 0 })),
      failuresLast24h: Object.values(failures).reduce((a, b) => a + b, 0),
    },
    gmail: gmail
      ? { connected: gmail.status === 'CONNECTED', status: gmail.status, email: gmail.email, lastSyncedAt: gmail.lastSyncedAt }
      : { connected: false, status: 'NOT_CONNECTED', email: null, lastSyncedAt: null },
    wellfound: { lastRun: wellfound },
    resumes: {
      count: resumes.length,
      defaultLabel: resumes.find((r) => r.isDefault)?.label ?? null,
    },
  };
}

// GET /api/overview - one-call system summary for the Profile page
overviewRouter.get('/overview', async (_req: Request, res: Response) => {
  try {
    res.json(await buildOverview());
  } catch (err) {
    console.error('Error building overview:', err);
    res.status(500).json({ error: 'Failed to build overview' });
  }
});
