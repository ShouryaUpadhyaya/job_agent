import { describe, it, expect } from 'vitest';
import { parseResumeText } from '../resumes/parser';

describe('Resume Parser (Heuristic & Taxonomy)', () => {
  const sampleResume = `
Shourya Upadhyaya
shourya@example.com | +91 9876543210 | github.com/shourya | linkedin.com/in/shourya

EDUCATION
Vellore Institute of Technology (VIT Vellore)
Bachelor of Technology in Computer Science and Engineering
Expected Graduation: May 2028 | CGPA: 9.2/10.0

SKILLS
Programming: TypeScript, JavaScript, Python, C++, SQL, Go
Frameworks: React, Next.js, Node.js, Express, Tailwind CSS
Databases & Cloud: PostgreSQL, Prisma, Redis, Docker, Linux, Git, AWS
Architecture: REST APIs, WebSockets, Distributed Systems, Microservices

PROJECTS
Autonomous Job Search Agent
- Engineered a high-throughput job ingestion pipeline using TypeScript, Express, and PostgreSQL.
- Implemented deterministic ATS matching algorithms scoring candidate profiles with 100% explainability.
- Integrated containerized PostgreSQL and Docker Compose for reliable local developer workflows.
`;

  it('should extract candidate contact information', () => {
    const parsed = parseResumeText(sampleResume);

    expect(parsed.name).toBe('Shourya Upadhyaya');
    expect(parsed.email).toBe('shourya@example.com');
    expect(parsed.phone).toContain('9876543210');
    expect(parsed.links).toBeDefined();
    expect(parsed.links?.some((l) => l.includes('github.com'))).toBe(true);
  });

  it('should extract technical skills based on taxonomy dictionary', () => {
    const parsed = parseResumeText(sampleResume);

    expect(parsed.skills).toContain('TypeScript');
    expect(parsed.skills).toContain('React');
    expect(parsed.skills).toContain('Node.js');
    expect(parsed.skills).toContain('PostgreSQL');
    expect(parsed.skills).toContain('Docker');
    expect(parsed.skills).toContain('REST APIs');
    expect(parsed.skills.length).toBeGreaterThanOrEqual(10);
  });

  it('should extract education institution, degree, and expected graduation year', () => {
    const parsed = parseResumeText(sampleResume);

    expect(parsed.education?.graduationYear).toBe(2028);
    expect(parsed.education?.institution).toContain('VIT');
    expect(parsed.education?.degree).toMatch(/bachelor|b\.tech/i);
  });

  it('should extract project experience bullet points', () => {
    const parsed = parseResumeText(sampleResume);

    expect(parsed.experience).toBeDefined();
    expect(parsed.experience?.[0].bullets?.length).toBeGreaterThan(0);
    expect(parsed.experience?.[0].bullets?.some((b) => b.includes('TypeScript'))).toBe(true);
  });
});
