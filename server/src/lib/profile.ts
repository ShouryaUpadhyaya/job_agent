import { CandidateProfile, Prisma } from '@prisma/client';
import { prisma } from '../db';

/**
 * Job Agent is single-user: there is one candidate profile. Every module resolves it
 * through these helpers instead of ad-hoc `findFirst()` calls.
 */

const DEFAULT_PROFILE: Prisma.CandidateProfileCreateInput = {
  name: 'Your Name',
  targetRole: 'Software Engineer Intern',
  targetGradYear: 2028,
  skills: [],
  preferredLocations: ['India', 'Remote'],
};

export async function getActiveProfile(): Promise<CandidateProfile | null> {
  return prisma.candidateProfile.findFirst({ orderBy: { id: 'asc' } });
}

export async function ensureActiveProfile(): Promise<CandidateProfile> {
  const existing = await getActiveProfile();
  if (existing) return existing;
  return prisma.candidateProfile.create({ data: DEFAULT_PROFILE });
}

/** Resumes of the active profile, default first. */
export async function getProfileResumes(profileId: string) {
  return prisma.resume.findMany({
    where: { candidateProfileId: profileId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
}
