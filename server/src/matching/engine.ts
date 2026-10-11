import { CandidateProfile, JobListing } from '@prisma/client';

export type MatchResult = {
  score: number;
  classification: 'APPLY' | 'REVIEW' | 'SKIP';
  reasons: string[];
};

export function matchJob(profile: Pick<CandidateProfile, 'skills'>, job: Pick<JobListing, 'title' | 'description' | 'company'>): MatchResult {
  let score = 0;
  const reasons: string[] = [];

  const titleLower = job.title.toLowerCase();
  const descriptionLower = (job.description || '').toLowerCase();

  for (const skill of profile.skills) {
    const skillLower = skill.toLowerCase();
    
    // Boost for skill in title
    if (titleLower.includes(skillLower)) {
      score += 30;
      reasons.push(`Job title contains key skill: ${skill}`);
    } else if (descriptionLower.includes(skillLower)) {
      // Boost for skill in description
      score += 15;
      reasons.push(`Job description contains key skill: ${skill}`);
    }
  }

  // Cap score at 100 for normalization if desired, but not strictly necessary
  // Let's keep it simple

  let classification: 'APPLY' | 'REVIEW' | 'SKIP' = 'SKIP';
  
  if (score > 50) {
    classification = 'APPLY';
  } else if (score >= 20) {
    classification = 'REVIEW';
  } else {
    classification = 'SKIP';
  }

  return {
    score,
    classification,
    reasons,
  };
}
