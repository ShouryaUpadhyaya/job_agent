import { describe, it, expect } from 'vitest';
import { tailorResume, tailorCoverLetter } from '../resumes/tailor';
import { CandidateProfile, JobListing } from '@prisma/client';

describe('Resume and Cover Letter Tailoring Engine', () => {
  const mockProfile: CandidateProfile = {
    id: 'cand-1',
    name: 'Shourya Upadhyaya',
    email: 'shourya@example.com',
    targetRole: 'Software Engineer Intern',
    targetGradYear: 2028,
    rawResume: null,
    skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL', 'Docker', 'Linux', 'Git'],
    experience: null,
    education: {
      degree: 'B.Tech Computer Science',
      institution: 'VIT Vellore',
      graduationYear: 2028,
    },
  };

  const mockJob: JobListing = {
    id: 'job-1',
    externalId: 'ext-101',
    source: 'lever',
    title: 'Software Engineer Intern - Summer 2027',
    company: 'Spotify',
    url: 'https://jobs.lever.co/spotify/ext-101',
    description: 'Build backend audio streaming microservices using TypeScript, Node.js, and Redis. Work with Docker and Kubernetes.',
    location: 'Stockholm, Sweden',
    status: 'APPLY',
    score: 85,
    matchReasons: ['Target intern role'],
    matchedSkills: ['TypeScript', 'Node.js', 'Docker'],
    missingSkills: ['Redis', 'Kubernetes'],
    retrievedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('should tailor resume highlighting matching skills and missing keywords', () => {
    const result = tailorResume(mockProfile, mockJob);

    expect(result.matchedSkills).toContain('TypeScript');
    expect(result.matchedSkills).toContain('Node.js');
    expect(result.matchedSkills).toContain('Docker');
    expect(result.missingKeywords).toContain('Redis');
    expect(result.formattedMarkdown).toContain('Spotify');
    expect(result.formattedMarkdown).toContain('Shourya Upadhyaya');
    expect(result.formattedMarkdown).toContain('Direct ATS Skill Matches');
    expect(result.highlightedBullets.length).toBeGreaterThan(0);
  });

  it('should generate personalized, high-conversion cover letter', () => {
    const result = tailorCoverLetter(mockProfile, mockJob);

    expect(result.recipient).toContain('Spotify Hiring Team');
    expect(result.subject).toContain('Software Engineer Intern');
    expect(result.body).toContain('2028');
    expect(result.body).toContain('TypeScript');
    expect(result.formattedMarkdown).toContain('Dear Spotify Hiring Team');
    expect(result.formattedMarkdown).toContain('Shourya Upadhyaya');
  });
});
