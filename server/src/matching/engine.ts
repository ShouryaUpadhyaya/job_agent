import { CandidateProfile, JobListing } from '@prisma/client';

export type MatchResult = {
  score: number;
  classification: 'APPLY' | 'REVIEW' | 'SKIP';
  reasons: string[];
  matchedSkills: string[];
  missingSkills: string[];
  disqualifications: string[];
  eligibilityConcerns: string[];
};

export interface MatchOptions {
  enforceSeniorityConstraint?: boolean;
  targetGraduationYear?: number;
  preferredLocations?: string[];
}

export function matchJob(
  profile: Pick<CandidateProfile, 'skills'> & { education?: any; experience?: any },
  job: Pick<JobListing, 'title' | 'description' | 'company'> & { location?: string | null },
  options: MatchOptions = {}
): MatchResult {
  let score = 0;
  const reasons: string[] = [];
  const matchedSkills: string[] = [];
  const missingSkills: string[] = [];
  const disqualifications: string[] = [];
  const eligibilityConcerns: string[] = [];

  const title = job.title || '';
  const description = job.description || '';
  const titleLower = title.toLowerCase();
  const descriptionLower = description.toLowerCase();
  const locationLower = (job.location || '').toLowerCase();

  // 1. Evaluate Skills
  const knownTechCatalog = [
    'typescript', 'javascript', 'python', 'java', 'golang', 'c++', 'c#', 'ruby', 'rust',
    'react', 'next.js', 'vue', 'angular', 'node.js', 'express', 'postgresql', 'mysql',
    'mongodb', 'redis', 'docker', 'kubernetes', 'linux', 'git', 'aws', 'gcp', 'graphql',
    'rest apis', 'sql', 'websockets'
  ];

  for (const skill of profile.skills || []) {
    const skillLower = skill.toLowerCase();
    
    // Skill in title gives strong boost
    if (titleLower.includes(skillLower)) {
      score += 30;
      matchedSkills.push(skill);
      reasons.push(`Job title contains key skill: ${skill}`);
    } else if (descriptionLower.includes(skillLower)) {
      // Skill in description
      score += 15;
      matchedSkills.push(skill);
      reasons.push(`Job description contains key skill: ${skill}`);
    }
  }

  // Detect missing tech that might be required
  for (const tech of knownTechCatalog) {
    if (descriptionLower.includes(tech) && !profile.skills.some(s => s.toLowerCase() === tech)) {
      if (
        descriptionLower.includes(`required: ${tech}`) ||
        descriptionLower.includes(`must have ${tech}`) ||
        descriptionLower.includes(`experience with ${tech}`)
      ) {
        missingSkills.push(tech);
      }
    }
  }

  // 2. Role Relevance & Seniority Check
  // Check if profile specifies internship preference
  const isTargetingInternship = Boolean(
    options.enforceSeniorityConstraint ??
    (profile.experience && JSON.stringify(profile.experience).toLowerCase().includes('intern'))
  );

  const seniorKeywords = ['senior', 'staff', 'principal', 'lead developer', 'tech lead', 'engineering manager', 'director', 'vp of', 'head of'];
  const hasSeniorKeyword = seniorKeywords.some((keyword) => titleLower.includes(keyword));

  if (isTargetingInternship && hasSeniorKeyword) {
    disqualifications.push('Seniority mismatch: Role requires Senior/Lead/Staff level, but candidate targets internships.');
    reasons.push('Disqualified: Seniority mismatch (Senior/Staff/Lead role)');
  }

  const internKeywords = ['intern', 'internship', 'co-op', 'trainee', 'campus', 'new grad', 'graduate engineer', 'junior'];
  const isInternRole = internKeywords.some((keyword) => titleLower.includes(keyword) || descriptionLower.includes(keyword));

  if (isInternRole) {
    score += 35;
    reasons.push('High role relevance: Matches internship / early-career target');
  }

  // 3. Experience & Graduation Year Constraints
  if (isTargetingInternship) {
    const targetRoleCategories = ['software engineer', 'backend', 'full-stack', 'fullstack', 'developer infrastructure', 'infrastructure'];
    for (const cat of targetRoleCategories) {
      if (titleLower.includes(cat)) {
        score += 20;
        reasons.push(`Role matches target engineering category: ${cat}`);
        break;
      }
    }
    // Flag if requires 5+ years of experience
    if (descriptionLower.match(/\b([5-9]|\d{2})\+?\s*years?(\s+of)?\s+experience/i)) {
      disqualifications.push('Experience constraint: Requires 5+ years of professional industry experience.');
      reasons.push('Disqualified: Requires 5+ years of experience');
    }

    // Check graduation year mentions
    if (descriptionLower.includes('2027') || descriptionLower.includes('2028')) {
      score += 25;
      reasons.push('Matches graduation year eligibility (2027/2028 cohort)');
    } else if (descriptionLower.includes('must graduate by 2024') || descriptionLower.includes('must graduate by 2025')) {
      eligibilityConcerns.push('Graduation cohort constraint: Listing may require graduation prior to 2028.');
    }
  }

  // 4. Location & Remote Preferences
  if (locationLower.includes('india') || locationLower.includes('remote') || locationLower.includes('worldwide') || locationLower.includes('anywhere')) {
    score += 15;
    reasons.push(`Favorable location: ${job.location || 'Remote'}`);
  }

  // 5. Incomplete / Ambiguous Data Safeguards
  if (!description || description.trim().length < 50) {
    eligibilityConcerns.push('Listing has sparse or missing description; cannot fully verify qualifications.');
  }

  // 6. Classification
  let classification: 'APPLY' | 'REVIEW' | 'SKIP' = 'SKIP';

  if (disqualifications.length > 0) {
    classification = 'SKIP';
  } else if (score > 50) {
    // If there are significant eligibility concerns, downgrade APPLY to REVIEW
    if (eligibilityConcerns.length > 0 && !isInternRole) {
      classification = 'REVIEW';
      reasons.push('Marked for REVIEW due to eligibility concerns despite score.');
    } else {
      classification = 'APPLY';
    }
  } else if (score >= 20) {
    classification = 'REVIEW';
  } else {
    classification = 'SKIP';
  }

  return {
    score,
    classification,
    reasons,
    matchedSkills: Array.from(new Set(matchedSkills)),
    missingSkills: Array.from(new Set(missingSkills)),
    disqualifications,
    eligibilityConcerns,
  };
}
