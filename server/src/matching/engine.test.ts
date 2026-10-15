import { describe, it, expect } from 'vitest';
import { matchJob, requiredYearsOfExperience, graduationYearsMentioned, isEntryLevelProfile, MatchProfile } from './engine';
import { extractSkills, textHasSkill } from './skills';
import { scoreJobAcrossResumes, resumeSkills, flattenReasons } from './resumeScoring';

const NOW = new Date('2026-10-15T00:00:00Z');

const intern: MatchProfile = {
  skills: ['TypeScript', 'Node.js', 'React', 'PostgreSQL', 'Docker', 'Git'],
  targetRole: 'Backend Engineer Intern',
  targetGradYear: 2028,
  preferredLocations: ['India', 'Remote'],
  remoteOk: true,
};

const job = (over: Partial<{ title: string; description: string; location: string; publishedAt: Date }>) => ({
  title: 'Software Engineer Intern',
  company: 'Acme',
  description: 'Work on our product with a friendly team. We value curiosity and ownership in everything we build.',
  location: 'Bengaluru, India',
  ...over,
});

describe('skill tokenizer', () => {
  it('does not match substrings across different technologies', () => {
    expect(textHasSkill('We use JavaScript and TypeScript', 'Java')).toBe(false);
    expect(textHasSkill('Strong Java and Spring skills', 'Java')).toBe(true);
    expect(textHasSkill('Experience with PostgreSQL', 'SQL')).toBe(false);
    expect(textHasSkill('Write SQL queries', 'SQL')).toBe(true);
    expect(textHasSkill('Contribute on GitHub', 'Git')).toBe(false);
    expect(textHasSkill('Familiar with Git and GitHub', 'Git')).toBe(true);
    expect(textHasSkill('Built with Node.js', 'JavaScript')).toBe(false);
  });

  it('only treats "Go" as the language in a skills context, and never inside Google', () => {
    expect(textHasSkill('Join Google as an engineer', 'Go')).toBe(false);
    expect(textHasSkill('Ready to go above and beyond', 'Go')).toBe(false);
    expect(textHasSkill('Go to market with us', 'Go')).toBe(false);
    expect(textHasSkill('Backend services in Go, Python or Rust', 'Go')).toBe(true);
    expect(textHasSkill('We write golang microservices', 'Go')).toBe(true);
  });

  it('resolves aliases', () => {
    expect(textHasSkill('Experience with NodeJS', 'Node.js')).toBe(true);
    expect(textHasSkill('Experience with node.js', 'nodejs')).toBe(true);
    expect(textHasSkill('Deploy on k8s', 'Kubernetes')).toBe(true);
    expect(textHasSkill('Postgres knowledge', 'PostgreSQL')).toBe(true);
    expect(textHasSkill('Strong in C++ and C#', 'C++')).toBe(true);
    expect(textHasSkill('Strong in C#', 'C++')).toBe(false);
    expect(textHasSkill('Apps in Next.js', 'Next.js')).toBe(true);
  });

  it('avoids common English-word false positives', () => {
    expect(textHasSkill('Teams react quickly to incidents', 'React')).toBe(false);
    expect(textHasSkill('Build apps with React Native', 'React')).toBe(false);
    expect(textHasSkill('American Express card benefits', 'Express')).toBe(false);
    expect(textHasSkill('APIs with Node.js and Express', 'Express')).toBe(true);
    expect(textHasSkill('The rest of the team', 'REST APIs')).toBe(false);
  });

  it('extracts vocabulary skills from text', () => {
    expect(extractSkills('Python, Go and Kubernetes; JavaScript a plus')).toEqual(
      expect.arrayContaining(['Python', 'Go', 'Kubernetes', 'JavaScript'])
    );
    expect(extractSkills('JavaScript only')).not.toContain('Java');
  });
});

describe('matchJob', () => {
  it('does not treat "international" as an internship', () => {
    const r = matchJob(intern, job({ title: 'International Sales Executive', description: 'Drive international sales in EMEA markets for our enterprise customers across regions.' }), { now: NOW });
    expect(r.reasons.join(' ')).not.toMatch(/internship/i);
    expect(r.classification).toBe('SKIP');
  });

  it('clamps the score to 0-100', () => {
    const r = matchJob(
      { ...intern, skills: ['TypeScript', 'Node.js', 'React', 'PostgreSQL', 'Docker', 'Redis', 'GraphQL', 'AWS'] },
      job({
        title: 'Backend TypeScript Node.js React Intern',
        description: 'Internship for 2028 graduates: TypeScript, Node.js, React, PostgreSQL, Docker, Redis, GraphQL, AWS.',
        publishedAt: NOW,
      }),
      { now: NOW }
    );
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThan(80);
    expect(r.classification).toBe('APPLY');
  });

  it('rates a matching internship APPLY with explainable reasons', () => {
    const r = matchJob(
      intern,
      job({
        title: 'Backend Engineering Intern',
        description: 'Students graduating in 2028. You will build REST APIs with TypeScript, Node.js and PostgreSQL.',
        publishedAt: new Date('2026-10-13T00:00:00Z'),
      }),
      { now: NOW }
    );
    expect(r.classification).toBe('APPLY');
    expect(r.matchedSkills).toEqual(expect.arrayContaining(['TypeScript', 'Node.js', 'PostgreSQL']));
    expect(r.reasons).toEqual(expect.arrayContaining(['Internship role', 'Location: India', 'Posted in the last 3 days']));
    expect(r.reasons.some((x) => x.includes('2028'))).toBe(true);
    expect(r.missingSkills).toContain('REST APIs');
  });

  it.each([
    'Senior Software Engineer',
    'Sr. Backend Engineer',
    'Staff Engineer',
    'Principal Engineer',
    'Engineering Manager',
    'Tech Lead - Payments',
    'Software Engineer II',
    'Software Engineer III',
    'SDE-2, Platform',
    'SDE 3',
  ])('skips "%s" for an intern profile', (title) => {
    const r = matchJob(intern, job({ title, description: 'Build backend services with TypeScript, Node.js and PostgreSQL at scale for millions.' }), { now: NOW });
    expect(r.classification).toBe('SKIP');
    expect(r.disqualifications[0]).toMatch(/Seniority mismatch/);
    expect(r.score).toBeLessThanOrEqual(15);
  });

  it('skips roles needing 2+ years of experience for an intern profile', () => {
    const r = matchJob(intern, job({ title: 'Backend Engineer', description: 'You have 3+ years of experience with Node.js and TypeScript in production.' }), { now: NOW });
    expect(r.classification).toBe('SKIP');
    expect(r.disqualifications.some((d) => d.includes('3+ years'))).toBe(true);
  });

  it('does not penalise "0-2 years" or 1 year entry roles as seniority', () => {
    expect(requiredYearsOfExperience('0-2 years of experience')).toBe(0);
    expect(requiredYearsOfExperience('Minimum 2 years of professional experience')).toBe(2);
    expect(requiredYearsOfExperience('Experience: 4+ years')).toBe(4);
    expect(requiredYearsOfExperience('We have been around for 10 years')).toBeNull();
  });

  it('accepts ±1 graduation years and penalises explicit mismatches', () => {
    expect(graduationYearsMentioned('Open to 2027 graduates')).toEqual([2027]);
    expect(graduationYearsMentioned('Summer 2027 internship')).toEqual([]);
    const ok = matchJob(intern, job({ description: 'Open to students graduating in 2029. Work on TypeScript services.' }), { now: NOW });
    expect(ok.eligibilityConcerns.join(' ')).not.toMatch(/cohort/);
    const bad = matchJob(intern, job({ description: 'Only for the 2025 batch of B.Tech graduates. TypeScript services.' }), { now: NOW });
    expect(bad.eligibilityConcerns.some((c) => c.includes('cohort mismatch'))).toBe(true);
    expect(bad.score).toBeLessThan(ok.score);
  });

  it('uses the profile grad year instead of a hardcoded one', () => {
    const p2030 = { ...intern, targetGradYear: 2030 };
    const r = matchJob(p2030, job({ description: 'For 2027 and 2028 graduates. TypeScript and Node.js.' }), { now: NOW });
    expect(r.eligibilityConcerns.some((c) => c.includes('cohort mismatch'))).toBe(true);
  });

  it('uses preferred locations and remote preference', () => {
    const pune = { ...intern, preferredLocations: ['Pune'], remoteOk: false };
    expect(matchJob(pune, job({ location: 'Pune, Maharashtra' }), { now: NOW }).reasons).toContain('Location: Pune');
    const remote = matchJob(pune, job({ location: 'Remote' }), { now: NOW });
    expect(remote.reasons).not.toContain('Remote-friendly');
    const far = matchJob(intern, job({ location: 'New York, NY' }), { now: NOW });
    expect(far.eligibilityConcerns.some((c) => c.includes('outside your preferences'))).toBe(true);
    const usRemote = matchJob(intern, job({ location: 'Remote (US only)' }), { now: NOW });
    expect(usRemote.reasons).toContain('Remote (region-restricted)');
  });

  it('ranks on-site roles abroad well below the same role in India for an India-preferring profile', () => {
    const india = matchJob(intern, job({ location: 'Bengaluru, India' }), { now: NOW });
    const paris = matchJob(intern, job({ location: 'Paris, France' }), { now: NOW });
    expect(india.score - paris.score).toBeGreaterThanOrEqual(40);
    expect(paris.classification).not.toBe('APPLY');
  });

  it('does not boost non-engineering internships', () => {
    const r = matchJob(intern, job({ title: 'Marketing Intern', description: 'Run campaigns and social media for our brand across India.' }), { now: NOW });
    expect(r.eligibilityConcerns).toContain('Not an engineering role.');
    expect(r.classification).toBe('SKIP');
  });

  it('treats remote roles limited to another country as region-restricted', () => {
    expect(matchJob(intern, job({ location: 'Remote (Ireland)' }), { now: NOW }).reasons).toContain('Remote (region-restricted)');
    expect(matchJob(intern, job({ location: 'Remote (Worldwide)' }), { now: NOW }).reasons).toContain('Remote-friendly');
    expect(matchJob(intern, job({ location: 'Remote / Hybrid' }), { now: NOW }).reasons).toContain('Remote-friendly');
  });

  it('decays with age', () => {
    const fresh = matchJob(intern, job({ publishedAt: new Date('2026-10-14T00:00:00Z') }), { now: NOW });
    const old = matchJob(intern, job({ publishedAt: new Date('2026-07-01T00:00:00Z') }), { now: NOW });
    expect(fresh.score - old.score).toBeGreaterThanOrEqual(10);
  });

  it('infers entry-level targeting from the profile', () => {
    expect(isEntryLevelProfile({ skills: [], targetRole: 'Software Engineer Intern' })).toBe(true);
    expect(isEntryLevelProfile({ skills: [], targetRole: 'Senior Backend Engineer', targetGradYear: 2015 })).toBe(false);
    expect(isEntryLevelProfile({ skills: [], targetRole: 'Senior Backend Engineer' }, { enforceSeniorityConstraint: true })).toBe(true);
  });

  it('does not disqualify senior titles for experienced profiles', () => {
    const exp: MatchProfile = { skills: ['TypeScript', 'React'], targetRole: 'Senior Frontend Engineer', targetGradYear: 2018 };
    const r = matchJob(exp, job({ title: 'Senior TypeScript and React Developer', description: 'Build UIs with React and TypeScript for our customers worldwide.' }), { now: NOW });
    expect(r.disqualifications).toHaveLength(0);
    expect(r.matchedSkills).toEqual(['TypeScript', 'React']);
  });

  it('classifies unrelated jobs as SKIP', () => {
    const r = matchJob(intern, job({ title: 'Java Developer', description: 'Spring Boot and Java microservices. 5+ years of experience required.' }), { now: NOW });
    expect(r.classification).toBe('SKIP');
    expect(r.matchedSkills).toHaveLength(0);
  });
});

describe('multi-resume scoring', () => {
  const resumes = [
    { id: 'r-front', label: 'Frontend', skills: ['React', 'CSS'], content: '' },
    { id: 'r-back', label: 'Backend', skills: [], content: 'Projects: REST APIs in Node.js with PostgreSQL, Docker and Redis.' },
  ];

  it('derives skills from resume content', () => {
    expect(resumeSkills(resumes[1])).toEqual(expect.arrayContaining(['Node.js', 'PostgreSQL', 'Docker', 'Redis']));
  });

  it('picks the best resume and records every score', () => {
    const m = scoreJobAcrossResumes(intern, resumes, job({ title: 'Backend Intern', description: 'Internship: Node.js, PostgreSQL and Redis services in Docker.' }), { now: NOW });
    expect(m.bestResumeId).toBe('r-back');
    expect(Object.keys(m.scoresByResume!)).toEqual(['r-front', 'r-back']);
    expect(m.scoresByResume!['r-back']).toBeGreaterThan(m.scoresByResume!['r-front']);
  });

  it('falls back to profile skills without resumes', () => {
    const m = scoreJobAcrossResumes(intern, [], job({}), { now: NOW });
    expect(m.bestResumeId).toBeNull();
    expect(m.scoresByResume).toBeNull();
  });

  it('flattens reasons with prefixes for disqualifications and concerns', () => {
    const r = matchJob(intern, job({ title: 'Senior Engineer', location: 'Berlin' }), { now: NOW });
    const flat = flattenReasons(r);
    expect(flat.some((x) => x.startsWith('SKIP: '))).toBe(true);
    expect(flat.some((x) => x.startsWith('CHECK: '))).toBe(true);
  });
});
