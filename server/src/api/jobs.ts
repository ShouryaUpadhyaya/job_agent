import { Router } from 'express';
import { Prisma, JobListing } from '@prisma/client';
import { prisma } from '../db';
import { normalizeWellfoundJob } from '../connectors/wellfound';
import { normalizeLinkedInJob, generatePreApplicationChecklist, extractLinkedInJobId } from '../connectors/linkedin';
import { FEED_TAG_PREFIX, RawJobPayload } from '../connectors/types';
import { cleanHtml, stableHash } from '../connectors/utils';
import { processAndUpsertJob } from '../jobs/normalization';
import { listingVerification, checkStaleListings } from '../jobs/liveness';
import { ensureActiveProfile, getActiveProfile, getProfileResumes } from '../lib/profile';
import { canTransition, isStage, statusForStage, Stage } from '../lib/stages';
import { companyKey } from '../lib/company';
import { buildSearchLinks } from '../discovery/searchLinks';
import { getXSources } from '../discovery/xSources';
import { ingestJobAlertEmail } from '../discovery/jobAlerts';
import { extractSkills } from '../matching/skills';

export const jobsRouter = Router();

const USER_STATUSES = ['NONE', 'SAVED', 'DISMISSED'] as const;
const APPLIED_STAGES = ['APPLIED', 'INTERVIEWING', 'OFFERED', 'REJECTED'];
const STAGE_ORDER = ['BOOKMARKED', 'APPLYING', 'APPLIED', 'INTERVIEWING', 'OFFERED', 'REJECTED', 'ARCHIVED'];

/** Display labels for source ids (legacy capitalised values map to the same label). */
const SOURCE_LABELS: Record<string, string> = {
  greenhouse: 'Greenhouse',
  ashby: 'Ashby',
  lever: 'Lever',
  smartrecruiters: 'SmartRecruiters',
  workable: 'Workable',
  remotive: 'Remotive',
  remoteok: 'Remote OK',
  arbeitnow: 'Arbeitnow',
  rss: 'RSS',
  jsonapi: 'JSON feed',
  wellfound: 'Wellfound',
  linkedin: 'LinkedIn (pasted)',
  manual: 'Added manually',
  'email:linkedin': 'LinkedIn alerts',
  'email:naukri': 'Naukri alerts',
  'email:internshala': 'Internshala alerts',
  'email:wellfound': 'Wellfound alerts',
  'email:instahyre': 'Instahyre alerts',
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source.toLowerCase()] || source;
}

const ATTRIBUTION: Record<string, { label: string; url: string }> = {
  remotive: { label: 'via Remotive', url: 'https://remotive.com' },
  remoteok: { label: 'via Remote OK', url: 'https://remoteok.com' },
};

const bool = (v: unknown, fallback: boolean): boolean => {
  if (v === undefined || v === null || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

const list = (v: unknown): string[] =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Placeholder listings created from application-confirmation emails (source 'email', no
 * description, score 0) exist only to anchor a pipeline entry; Discovery never lists them.
 * Job-alert listings use 'email:<provider>' and are unaffected.
 */
const NOT_EMAIL_PLACEHOLDER: Prisma.JobListingWhereInput = { source: { not: 'email' } };

export function buildJobsWhere(query: Record<string, unknown>, now = new Date()): Prisma.JobListingWhereInput {
  const and: Prisma.JobListingWhereInput[] = [NOT_EMAIL_PLACEHOLDER];

  if (bool(query.activeOnly, true)) and.push({ isActive: true });
  if (bool(query.hideDismissed, true)) and.push({ userStatus: { not: 'DISMISSED' } });
  if (bool(query.savedOnly, false)) and.push({ userStatus: 'SAVED' });
  if (bool(query.internshipOnly, false)) and.push({ isInternship: true });
  if (bool(query.hideApplied, false)) and.push({ applications: { none: { stage: { in: APPLIED_STAGES } } } });

  const status = list(query.status).filter((s) => s !== 'ALL');
  if (status.length) and.push({ status: { in: status } });

  const minScore = parseInt(String(query.minScore ?? ''), 10);
  if (!isNaN(minScore) && minScore > 0) and.push({ score: { gte: minScore } });

  const days = parseInt(String(query.postedWithinDays ?? ''), 10);
  if (!isNaN(days) && days > 0) {
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    and.push({ OR: [{ publishedAt: { gte: cutoff } }, { publishedAt: null, createdAt: { gte: cutoff } }] });
  }

  const sources = [...list(query.sources), ...list(query.source)];
  if (sources.length) {
    and.push({
      OR: sources.map((s) =>
        s === 'email' || s === 'email:*'
          ? { source: { startsWith: 'email:' } }
          : { source: { equals: s, mode: 'insensitive' as const } }
      ),
    });
  }

  if (query.resumeId) and.push({ bestResumeId: String(query.resumeId) });

  if (query.location) {
    const loc = String(query.location);
    and.push({ location: { contains: loc, mode: 'insensitive' } });
  }
  if (bool(query.remote, false)) {
    and.push({
      OR: [
        { location: { contains: 'remote', mode: 'insensitive' } },
        { title: { contains: 'remote', mode: 'insensitive' } },
        { location: { contains: 'anywhere', mode: 'insensitive' } },
      ],
    });
  }

  const q = String(query.q ?? query.search ?? '').trim();
  if (q) {
    and.push({
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { company: { contains: q, mode: 'insensitive' } },
        { location: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ],
    });
  }

  return { AND: and };
}

export function buildJobsOrderBy(sort: unknown): Prisma.JobListingOrderByWithRelationInput[] {
  switch (String(sort || 'best')) {
    case 'newest':
      return [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'asc' }];
    case 'company':
      return [{ company: 'asc' }, { score: 'desc' }, { id: 'asc' }];
    case 'best':
    default:
      return [{ score: 'desc' }, { publishedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'asc' }];
  }
}

type ListingWithApps = JobListing & { applications?: { id: string; stage: string }[] };

export function presentJob(
  job: ListingWithApps,
  resumeLabels: Map<string, string>,
  options: { truncate?: number } = {},
  now = new Date()
) {
  const { applications, ...rest } = job;
  const apps = applications || [];
  const best = [...apps].sort((a, b) => STAGE_ORDER.indexOf(b.stage) - STAGE_ORDER.indexOf(a.stage))[0];
  const verification = listingVerification(job, now);
  const sourceKey = job.source.toLowerCase();
  const description =
    options.truncate && job.description.length > options.truncate
      ? `${job.description.slice(0, options.truncate).trimEnd()}…`
      : job.description;

  return {
    ...rest,
    description,
    descriptionTruncated: description !== job.description,
    tags: (job.tags || []).filter((t) => !t.startsWith(FEED_TAG_PREFIX)),
    sourceLabel: sourceLabel(job.source),
    attribution: ATTRIBUTION[sourceKey] || null,
    applicationId: best?.id || null,
    appliedStage: best?.stage || null,
    bestResumeLabel: job.bestResumeId ? resumeLabels.get(job.bestResumeId) || null : null,
    freshness: {
      postedAt: (job.publishedAt ?? job.createdAt)?.toISOString?.() ?? null,
      postedAtIsEstimate: !job.publishedAt,
      ageDays: verification.ageDays,
      lastSeenAt: job.lastSeenAt,
      lastCheckedAt: job.lastCheckedAt,
    },
    verified: verification.verified,
    verificationLabel: verification.label,
  };
}

async function resumeLabelMap(): Promise<Map<string, string>> {
  const profile = await getActiveProfile();
  if (!profile) return new Map();
  const resumes = await getProfileResumes(profile.id);
  return new Map(resumes.map((r) => [r.id, r.label]));
}

jobsRouter.get('/jobs', async (req, res) => {
  try {
    const query = req.query as Record<string, unknown>;
    const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(String(query.pageSize ?? '25'), 10) || 25));
    const where = buildJobsWhere(query);

    const [total, jobs, labels] = await Promise.all([
      prisma.jobListing.count({ where }),
      prisma.jobListing.findMany({
        where,
        orderBy: buildJobsOrderBy(query.sort),
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { applications: { select: { id: true, stage: true } } },
      }),
      resumeLabelMap(),
    ]);

    const now = new Date();
    res.json({
      jobs: jobs.map((j) => presentJob(j, labels, { truncate: 600 }, now)),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    });
  } catch (error) {
    console.error('Error fetching jobs:', error);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

jobsRouter.get('/jobs/facets', async (_req, res) => {
  try {
    const baseWhere: Prisma.JobListingWhereInput = { ...NOT_EMAIL_PLACEHOLDER, isActive: true, userStatus: { not: 'DISMISSED' } };
    const [bySource, total, internships, saved, dismissed, closed, profile] = await Promise.all([
      prisma.jobListing.groupBy({ by: ['source'], where: baseWhere, _count: { _all: true } }),
      prisma.jobListing.count({ where: baseWhere }),
      prisma.jobListing.count({ where: { ...baseWhere, isInternship: true } }),
      prisma.jobListing.count({ where: { ...NOT_EMAIL_PLACEHOLDER, isActive: true, userStatus: 'SAVED' } }),
      prisma.jobListing.count({ where: { ...NOT_EMAIL_PLACEHOLDER, userStatus: 'DISMISSED' } }),
      prisma.jobListing.count({ where: { ...NOT_EMAIL_PLACEHOLDER, isActive: false } }),
      getActiveProfile(),
    ]);

    const merged = new Map<string, number>();
    for (const row of bySource) {
      const key = row.source.toLowerCase();
      merged.set(key, (merged.get(key) || 0) + row._count._all);
    }
    const sources = [...merged.entries()]
      .map(([value, count]) => ({ value, label: sourceLabel(value), count }))
      .sort((a, b) => b.count - a.count);

    const resumes = profile ? await getProfileResumes(profile.id) : [];

    res.json({
      sources,
      total,
      internships,
      saved,
      dismissed,
      closed,
      resumes: resumes.map((r) => ({ id: r.id, label: r.label })),
    });
  } catch (error) {
    console.error('Error fetching job facets:', error);
    res.status(500).json({ error: 'Failed to fetch job facets' });
  }
});

jobsRouter.get('/jobs/:id', async (req, res) => {
  try {
    const job = await prisma.jobListing.findUnique({
      where: { id: req.params.id },
      include: { applications: true },
    });
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const presented = presentJob(job, await resumeLabelMap());
    res.json({ ...presented, applications: job.applications });
  } catch (error) {
    console.error('Error fetching job by id:', error);
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

jobsRouter.patch('/jobs/:id/user-status', async (req, res) => {
  try {
    const userStatus = String(req.body?.userStatus ?? '').toUpperCase();
    if (!(USER_STATUSES as readonly string[]).includes(userStatus)) {
      return res.status(400).json({ error: `userStatus must be one of ${USER_STATUSES.join(', ')}` });
    }
    const existing = await prisma.jobListing.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existing) return res.status(404).json({ error: 'Job not found' });
    const job = await prisma.jobListing.update({ where: { id: req.params.id }, data: { userStatus } });
    res.json({ id: job.id, userStatus: job.userStatus });
  } catch (error) {
    console.error('Error updating job user status:', error);
    res.status(500).json({ error: 'Failed to update job' });
  }
});

/**
 * Creates or advances the pipeline entry for an imported job. An existing application's stage
 * is only moved forward (never reset by a re-import).
 */
async function trackImportedJob(listing: JobListing, profileId: string, stageInput: unknown, notes: unknown, origin: string) {
  const targetStage: Stage = isStage(stageInput) ? stageInput : 'BOOKMARKED';
  const existingApp = await prisma.jobApplication.findFirst({
    where: { jobListingId: listing.id, candidateProfileId: profileId },
  });

  if (existingApp) {
    const advance = canTransition(existingApp.stage, targetStage, 'import');
    return prisma.jobApplication.update({
      where: { id: existingApp.id },
      data: {
        ...(advance ? { stage: targetStage, status: statusForStage(targetStage) } : {}),
        ...(notes && !existingApp.notes ? { notes: String(notes) } : {}),
      },
    });
  }

  return prisma.jobApplication.create({
    data: {
      jobListingId: listing.id,
      candidateProfileId: profileId,
      stage: targetStage,
      status: statusForStage(targetStage),
      isApproved: targetStage === 'APPLIED',
      submittedAt: targetStage === 'APPLIED' ? new Date() : undefined,
      companyKey: companyKey(listing.company),
      source: 'import',
      notes: notes ? String(notes) : `Imported from ${origin} (${listing.score ?? 0} pts match)`,
    },
  });
}

function detectPastedSource(url: string): 'linkedin' | 'wellfound' | 'manual' {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return 'linkedin';
    if (/(^|\.)(wellfound\.com|angel\.co)$/.test(host)) return 'wellfound';
  } catch {
    // fall through
  }
  return 'manual';
}

/** Builds a payload from details the user pasted. Nothing is fetched from the URL. */
export function pastedJobPayload(body: Record<string, any>): RawJobPayload {
  const url = String(body.url || '').trim();
  const source = body.source && body.source !== 'auto' ? String(body.source).toLowerCase() : detectPastedSource(url);
  const base = {
    url,
    title: String(body.title || '').trim(),
    company: String(body.company || '').trim(),
    description: String(body.description || ''),
    location: body.location ? String(body.location) : undefined,
    tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
  };
  if (source === 'linkedin') {
    return normalizeLinkedInJob({ ...base, isEasyApply: body.isEasyApply, workplaceType: body.workplaceType });
  }
  if (source === 'wellfound') {
    return normalizeWellfoundJob({ ...base, salary: body.salary, equity: body.equity, stage: body.stage });
  }
  return {
    externalId: `manual-${stableHash(url || `${base.company}|${base.title}`)}`,
    source: 'manual',
    title: base.title,
    company: base.company,
    url: base.url,
    description: cleanHtml(base.description),
    location: base.location?.trim(),
    tags: base.tags,
  };
}

async function importPasted(body: Record<string, any>, forcedSource?: string) {
  const payload = pastedJobPayload(forcedSource ? { ...body, source: forcedSource } : body);
  const profile = await ensureActiveProfile();
  const resumes = await getProfileResumes(profile.id);
  const result = await processAndUpsertJob(payload, profile, resumes);
  let application = null;
  if (body.trackInPipeline || body.stage) {
    application = await trackImportedJob(result.listing, profile.id, body.stage, body.notes, payload.source);
  }
  return { result, application };
}

function validatePasted(body: Record<string, any>): string | null {
  if (!body?.url || !body?.title || !body?.company || !body?.description) {
    return 'url, title, company, and description are required (paste them from the job page)';
  }
  try {
    const u = new URL(String(body.url));
    if (!/^https?:$/.test(u.protocol)) return 'url must be http(s)';
  } catch {
    return 'url must be a valid URL';
  }
  return null;
}

// Add a job from pasted details (any site). The URL is stored, never fetched.
jobsRouter.post('/jobs/import', async (req, res) => {
  try {
    const invalid = validatePasted(req.body);
    if (invalid) return res.status(400).json({ error: invalid });
    const { result, application } = await importPasted(req.body);
    res.status(result.isNew ? 201 : 200).json({
      message: result.isNew ? 'Job imported successfully' : 'Job listing updated',
      job: result.listing,
      isNew: result.isNew,
      application,
    });
  } catch (error: any) {
    console.error('Error importing job:', error);
    res.status(500).json({ error: error.message });
  }
});

jobsRouter.post('/jobs/import/wellfound', async (req, res) => {
  try {
    const invalid = validatePasted(req.body);
    if (invalid) return res.status(400).json({ error: invalid });
    const { result, application } = await importPasted(req.body, 'wellfound');
    res.status(result.isNew ? 201 : 200).json({
      message: result.isNew ? 'Job imported successfully' : 'Job listing updated',
      job: result.listing,
      isNew: result.isNew,
      application,
    });
  } catch (error: any) {
    console.error('Error importing Wellfound job:', error);
    res.status(500).json({ error: error.message });
  }
});

// LinkedIn import takes pasted details only; LinkedIn is never contacted.
jobsRouter.post('/jobs/import/linkedin', async (req, res) => {
  try {
    const invalid = validatePasted(req.body);
    if (invalid) return res.status(400).json({ error: invalid });
    if (extractLinkedInJobId(String(req.body.url)).startsWith('li-')) {
      return res.status(400).json({ error: 'Could not find a LinkedIn job id in the URL (expected .../jobs/view/<id>)' });
    }
    const { result, application } = await importPasted(req.body, 'linkedin');
    res.status(result.isNew ? 201 : 200).json({
      message: result.isNew ? 'Job imported successfully' : 'Job listing updated',
      job: result.listing,
      isNew: result.isNew,
      application,
    });
  } catch (error: any) {
    console.error('Error importing LinkedIn job:', error);
    res.status(500).json({ error: error.message });
  }
});

// The server-side LinkedIn scraper was removed (LinkedIn's terms forbid automated access).
jobsRouter.post('/jobs/scrape/linkedin', (_req, res) => {
  res.status(410).json({
    error: 'Automatic LinkedIn fetching was removed (LinkedIn terms of service). Paste the job title, company and description instead.',
  });
});

/** Skills found in pasted text, so the import form can preview what will be matched. */
jobsRouter.post('/jobs/parse-pasted', (req, res) => {
  const text = String(req.body?.description || '');
  res.json({ skills: extractSkills(text) });
});

jobsRouter.get('/jobs/:id/checklist', async (req, res) => {
  try {
    const job = await prisma.jobListing.findUnique({
      where: { id: req.params.id },
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const checklist = generatePreApplicationChecklist({
      title: job.title,
      company: job.company,
      url: job.url,
      tags: job.tags,
    });

    res.json({ job, checklist });
  } catch (error: any) {
    console.error('Error generating checklist:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manually trigger a small batch of liveness checks (the scheduler runs these too).
jobsRouter.post('/jobs/liveness/check', async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(String(req.body?.limit ?? '20'), 10) || 20));
    const summary = await checkStaleListings({ limit });
    res.json(summary);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Liveness check failed' });
  }
});

jobsRouter.get('/discovery/search-links', async (_req, res) => {
  try {
    const profile = await getActiveProfile();
    const resumes = profile ? await getProfileResumes(profile.id) : [];
    const topSkills = (resumes[0]?.skills?.length ? resumes[0].skills : profile?.skills || []).slice(0, 3);
    res.json({
      links: buildSearchLinks(
        {
          targetRole: profile?.targetRole,
          skills: profile?.skills,
          preferredLocations: profile?.preferredLocations,
          remoteOk: profile?.remoteOk,
          targetGradYear: profile?.targetGradYear,
        },
        topSkills
      ),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to build search links' });
  }
});

jobsRouter.get('/discovery/x-sources', (_req, res) => {
  res.json(getXSources());
});

// Parse a pasted/forwarded job-alert email (the Gmail sync will call ingestJobAlertEmail directly).
jobsRouter.post('/discovery/job-alerts', async (req, res) => {
  try {
    const { from, subject, html, text, receivedAt } = req.body || {};
    if (!from || (!html && !text)) return res.status(400).json({ error: 'from and html or text are required' });
    res.json(await ingestJobAlertEmail({ from, subject, html, text, receivedAt }));
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to ingest alert email' });
  }
});
