import { prisma } from '../db';
import { JobListing, Prisma } from '@prisma/client';
import { MatchProfile } from '../matching/engine';
import { scoreJobAcrossResumes, matchUpdateData, ResumeLike } from '../matching/resumeScoring';
import { cleanHtml, canonicalizeUrl } from '../connectors/utils';
import { RawJobPayload, LEGACY_SOURCE_NAMES } from '../connectors/types';
import { companyKey } from '../lib/company';

export type RawJobListing = Pick<
  JobListing,
  | 'externalId' | 'source' | 'title' | 'company' | 'url' | 'description' | 'location' | 'status' | 'score'
  | 'matchReasons' | 'matchedSkills' | 'missingSkills' | 'publishedAt' | 'tags' | 'companyKey' | 'isInternship'
  | 'employmentType' | 'bestResumeId'
> & { scoresByResume?: Prisma.InputJsonValue | typeof Prisma.DbNull };

/** Profile fields used for scoring at ingestion (Prisma's CandidateProfile satisfies it). */
export type ScoringProfile = MatchProfile & { id?: string };

const INTERNSHIP_RE = /\b(intern|internship|interns|trainee|apprentice)\b/i;

export interface IngestionResult {
  listing: JobListing;
  isNew: boolean;
}

export function cleanJobPayload(raw: Partial<RawJobPayload | JobListing> & { externalId: string; source: string; title: string; company: string; url: string; description: string }): RawJobListing {
  const cleanTitle = (raw.title || '').trim();
  const cleanCompany = (raw.company || '').trim();
  const cleanUrl = canonicalizeUrl(raw.url || '');
  const cleanDesc = cleanHtml(raw.description || '');
  const cleanLocation = raw.location ? (raw.location || '').trim() : null;

  return {
    externalId: String(raw.externalId).trim(),
    source: String(raw.source).trim(),
    title: cleanTitle,
    company: cleanCompany,
    url: cleanUrl,
    description: cleanDesc,
    location: cleanLocation,
    status: (raw as any).status || 'NEW',
    score: typeof (raw as any).score === 'number' ? (raw as any).score : 0,
    matchReasons: (raw as any).matchReasons || [],
    matchedSkills: (raw as any).matchedSkills || [],
    missingSkills: (raw as any).missingSkills || [],
    publishedAt: toDate((raw as any).publishedAt),
    tags: Array.isArray((raw as any).tags) ? (raw as any).tags.map(String) : [],
    companyKey: companyKey(cleanCompany),
    employmentType: (raw as any).employmentType || null,
    bestResumeId: null,
    isInternship:
      (raw as any).employmentType === 'INTERNSHIP' ||
      INTERNSHIP_RE.test(cleanTitle) ||
      INTERNSHIP_RE.test(((raw as any).tags || []).filter((t: string) => !String(t).startsWith('feed:')).join(' ')),
  };
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return isNaN(d.getTime()) ? null : d;
}

type RawInput = Partial<RawJobPayload | JobListing> & {
  externalId: string;
  source: string;
  title: string;
  company: string;
  url: string;
  description: string;
};

/**
 * Rows written before source ids were canonicalised (e.g. "Greenhouse") are found and moved
 * to the canonical id, so a listing is never duplicated across the rename.
 */
async function findExisting(externalId: string, source: string) {
  const existing = await prisma.jobListing.findUnique({
    where: { externalId_source: { externalId, source } },
  });
  if (existing) return existing;
  const legacy = LEGACY_SOURCE_NAMES[source];
  if (!legacy) return null;
  const old = await prisma.jobListing.findFirst({ where: { externalId, source: { in: legacy } } });
  if (!old) return null;
  return prisma.jobListing.update({ where: { id: old.id }, data: { source } });
}

export async function processAndUpsertJob(
  raw: RawInput,
  profile?: ScoringProfile | null,
  resumes?: ResumeLike[]
): Promise<IngestionResult> {
  const cleaned = cleanJobPayload(raw);

  if (profile) {
    let resumeList = resumes;
    if (!resumeList && profile.id) {
      resumeList = await prisma.resume.findMany({
        where: { candidateProfileId: profile.id },
        select: { id: true, label: true, skills: true, content: true },
      });
    }
    if ((profile.skills && profile.skills.length > 0) || (resumeList && resumeList.length > 0)) {
      const match = scoreJobAcrossResumes(profile, resumeList || [], {
        title: cleaned.title,
        description: cleaned.description,
        company: cleaned.company,
        location: cleaned.location,
        publishedAt: cleaned.publishedAt,
        employmentType: cleaned.employmentType,
      });
      Object.assign(cleaned, matchUpdateData(match));
    }
  }

  const existing = await findExisting(cleaned.externalId, cleaned.source);
  const now = new Date();

  const listing = existing
    ? await prisma.jobListing.update({
        where: { id: existing.id },
        data: {
          title: cleaned.title,
          company: cleaned.company,
          url: cleaned.url,
          description: cleaned.description,
          location: cleaned.location,
          status: cleaned.status,
          score: cleaned.score,
          matchReasons: cleaned.matchReasons,
          matchedSkills: cleaned.matchedSkills,
          missingSkills: cleaned.missingSkills,
          bestResumeId: cleaned.bestResumeId,
          ...(cleaned.scoresByResume !== undefined ? { scoresByResume: cleaned.scoresByResume } : {}),
          publishedAt: cleaned.publishedAt ?? undefined,
          tags: cleaned.tags,
          companyKey: cleaned.companyKey,
          isInternship: cleaned.isInternship,
          employmentType: cleaned.employmentType ?? undefined,
          retrievedAt: now,
          // Seen again in a feed: the listing is live.
          lastSeenAt: now,
          missedSyncs: 0,
          isActive: true,
          closedAt: null,
          closedReason: null,
        },
      })
    : await prisma.jobListing.create({
        data: {
          ...cleaned,
          retrievedAt: now,
          lastSeenAt: now,
        },
      });

  return {
    listing,
    isNew: !existing,
  };
}

export async function upsertJobListing(
  job: RawInput,
  profile?: ScoringProfile | null,
  resumes?: ResumeLike[]
): Promise<JobListing> {
  const result = await processAndUpsertJob(job, profile, resumes);
  return result.listing;
}
