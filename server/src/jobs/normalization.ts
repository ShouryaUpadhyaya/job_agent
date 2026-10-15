import { prisma } from '../db';
import { JobListing, CandidateProfile } from '@prisma/client';
import { matchJob } from '../matching/engine';
import { cleanHtml, canonicalizeUrl } from '../connectors/utils';
import { RawJobPayload } from '../connectors/types';
import { companyKey } from '../lib/company';

export type RawJobListing = Pick<
  JobListing,
  | 'externalId' | 'source' | 'title' | 'company' | 'url' | 'description' | 'location' | 'status' | 'score'
  | 'matchReasons' | 'matchedSkills' | 'missingSkills' | 'publishedAt' | 'tags' | 'companyKey' | 'isInternship'
>;

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
    isInternship: INTERNSHIP_RE.test(cleanTitle) || INTERNSHIP_RE.test(((raw as any).tags || []).join(' ')),
  };
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return isNaN(d.getTime()) ? null : d;
}

export async function processAndUpsertJob(
  raw: Partial<RawJobPayload | JobListing> & { externalId: string; source: string; title: string; company: string; url: string; description: string },
  profile?: (Pick<CandidateProfile, 'skills'> & { education?: any; experience?: any }) | null
): Promise<IngestionResult> {
  const cleaned = cleanJobPayload(raw);

  // If candidate profile provided, compute matching score and explainability
  if (profile && profile.skills && profile.skills.length > 0) {
    const match = matchJob(profile, {
      title: cleaned.title,
      description: cleaned.description,
      company: cleaned.company,
      location: cleaned.location,
    });

    cleaned.score = match.score;
    cleaned.status = match.classification;
    cleaned.matchReasons = match.reasons;
    cleaned.matchedSkills = match.matchedSkills;
    cleaned.missingSkills = match.missingSkills;
  }

  const existing = await prisma.jobListing.findUnique({
    where: {
      externalId_source: {
        externalId: cleaned.externalId,
        source: cleaned.source,
      },
    },
  });

  const listing = await prisma.jobListing.upsert({
    where: {
      externalId_source: {
        externalId: cleaned.externalId,
        source: cleaned.source,
      },
    },
    update: {
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
      publishedAt: cleaned.publishedAt ?? undefined,
      tags: cleaned.tags,
      companyKey: cleaned.companyKey,
      isInternship: cleaned.isInternship,
      retrievedAt: new Date(),
      // Seen again in a feed: the listing is live.
      lastSeenAt: new Date(),
      missedSyncs: 0,
    },
    create: {
      ...cleaned,
      retrievedAt: new Date(),
    },
  });

  return {
    listing,
    isNew: !existing,
  };
}

export async function upsertJobListing(
  job: Partial<RawJobPayload | JobListing> & { externalId: string; source: string; title: string; company: string; url: string; description: string },
  profile?: (Pick<CandidateProfile, 'skills'> & { education?: any; experience?: any }) | null
): Promise<JobListing> {
  const result = await processAndUpsertJob(job, profile);
  return result.listing;
}
