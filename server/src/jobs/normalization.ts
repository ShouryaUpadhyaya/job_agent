import { prisma } from '../db';
import { JobListing, CandidateProfile } from '@prisma/client';
import { matchJob } from '../matching/engine';
import { cleanHtml, canonicalizeUrl } from '../connectors/utils';
import { RawJobPayload } from '../connectors/types';

export type RawJobListing = Omit<JobListing, 'id' | 'createdAt' | 'updatedAt' | 'retrievedAt'>;

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
  };
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
      retrievedAt: new Date(),
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
