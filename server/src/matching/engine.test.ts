import { describe, it, expect } from 'vitest';
import { matchJob } from './engine';
import { CandidateProfile, JobListing } from '@prisma/client';

describe('Matching Engine', () => {
  const profile: Pick<CandidateProfile, 'skills'> = {
    skills: ['TypeScript', 'Node.js', 'React', 'GraphQL'],
  };

  it('should classify as APPLY when score > 50', () => {
    const job: Pick<JobListing, 'title' | 'description' | 'company'> = {
      title: 'Senior TypeScript and React Developer',
      description: 'We are looking for someone with Node.js experience.',
      company: 'Tech Corp',
    };

    const result = matchJob(profile, job);
    // TypeScript in title = +30
    // React in title = +30
    // Node.js in desc = +15
    // Total = 75 (> 50 -> APPLY)
    
    expect(result.classification).toBe('APPLY');
    expect(result.score).toBe(75);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('should classify as REVIEW when score is between 20 and 50', () => {
    const job: Pick<JobListing, 'title' | 'description' | 'company'> = {
      title: 'Backend Developer',
      description: 'Must have strong experience with Node.js and REST APIs.',
      company: 'Another Corp',
    };

    const result = matchJob(profile, job);
    // Node.js in desc = +15
    // Actually, we need to test >= 20 and <= 50. Let's adjust job to get exactly score between 20 and 50.
    // Let's add TypeScript to description:
    // Node.js in desc = +15
    // TypeScript in desc = +15
    // Total = 30
    const job2: Pick<JobListing, 'title' | 'description' | 'company'> = {
        title: 'Backend Developer',
        description: 'Must have strong experience with Node.js and TypeScript.',
        company: 'Another Corp',
    };
    const result2 = matchJob(profile, job2);
    expect(result2.classification).toBe('REVIEW');
    expect(result2.score).toBe(30);
  });

  it('should classify as SKIP when score < 20', () => {
    const job: Pick<JobListing, 'title' | 'description' | 'company'> = {
      title: 'Java Developer',
      description: 'We are looking for a Java developer with Spring Boot experience.',
      company: 'Enterprise Inc',
    };

    const result = matchJob(profile, job);
    expect(result.classification).toBe('SKIP');
    expect(result.score).toBe(0);
    expect(result.reasons.length).toBe(0);
  });
});
