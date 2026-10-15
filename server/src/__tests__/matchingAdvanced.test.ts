import { describe, it, expect } from 'vitest';
import { matchJob } from '../matching/engine';

describe('Enhanced Matching Engine with Eligibility and Constraints', () => {
  const internProfile = {
    skills: ['TypeScript', 'Node.js', 'React', 'PostgreSQL', 'Docker', 'Redis'],
    education: {
      degree: 'B.Tech CSE',
      institution: 'VIT Vellore',
      graduationYear: 2028,
    },
    experience: {
      target: '2027 software engineering internships',
      preferredRoles: ['Backend Engineering Intern', 'Full-Stack Engineering Intern'],
    },
  };

  it('should boost high-relevance internship roles matching graduation year', () => {
    const job = {
      title: 'Backend Engineering Intern (Summer 2027)',
      company: 'Stripe',
      description: 'Looking for 2027 or 2028 graduates. Must have experience with TypeScript, Node.js, and PostgreSQL.',
      location: 'India',
    };

    const result = matchJob(internProfile, job);
    expect(result.classification).toBe('APPLY');
    expect(result.score).toBeGreaterThan(80);
    expect(result.disqualifications).toHaveLength(0);
    expect(result.matchedSkills).toContain('TypeScript');
    expect(result.matchedSkills).toContain('Node.js');
    expect(result.matchedSkills).toContain('PostgreSQL');
    expect(result.reasons.some(r => r.includes('graduation year'))).toBe(true);
  });

  it('should disqualify Senior/Staff roles when candidate targets internships', () => {
    const job = {
      title: 'Senior Staff Backend Engineer',
      company: 'Enterprise Corp',
      description: 'Must have 7+ years of experience with Node.js and TypeScript.',
      location: 'Remote',
    };

    const result = matchJob(internProfile, job);
    expect(result.classification).toBe('SKIP');
    expect(result.disqualifications.length).toBeGreaterThan(0);
    expect(result.disqualifications.some(d => d.includes('Seniority mismatch'))).toBe(true);
  });

  it('should disqualify roles demanding 5+ years of experience', () => {
    const job = {
      title: 'Software Engineer',
      company: 'Tech Solutions',
      description: 'Requires 5+ years of experience building distributed systems in TypeScript and Docker.',
      location: 'Remote',
    };

    const result = matchJob(internProfile, job);
    expect(result.classification).toBe('SKIP');
    expect(result.disqualifications.some(d => d.includes('5+ years'))).toBe(true);
  });

  it('should identify missing required skills when explicitly specified', () => {
    const job = {
      title: 'Systems Engineering Intern',
      company: 'Embedded Co',
      description: 'Internship role. Required: c++ and experience with kubernetes. Nice to have Docker.',
      location: 'Remote',
    };

    const result = matchJob(internProfile, job);
    expect(result.missingSkills).toContain('C++');
    expect(result.missingSkills).toContain('Kubernetes');
    expect(result.matchedSkills).toContain('Docker');
  });

  it('should flag sparse descriptions in eligibilityConcerns and downgrade to REVIEW', () => {
    const job = {
      title: 'Fullstack Developer',
      company: 'Startup',
      description: 'Short desc.',
      location: 'India',
    };

    const result = matchJob(internProfile, job);
    expect(result.eligibilityConcerns.length).toBeGreaterThan(0);
  });
});
