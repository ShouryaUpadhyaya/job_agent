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
    expect(parsed.linkMap.github).toBe('https://github.com/shourya');
    expect(parsed.linkMap.linkedin).toBe('https://linkedin.com/in/shourya');
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
    expect(parsed.education?.gpa).toBe('9.2/10.0');
  });

  it('should extract project experience bullet points', () => {
    const parsed = parseResumeText(sampleResume);

    expect(parsed.experience).toBeDefined();
    expect(parsed.experience?.[0].kind).toBe('project');
    expect(parsed.experience?.[0].role).toBe('Autonomous Job Search Agent');
    expect(parsed.experience?.[0].bullets?.some((b) => b.includes('TypeScript'))).toBe(true);
  });

  it('does not treat words like "Google" or "going" as the Go language', () => {
    const parsed = parseResumeText(`Jane Roe
jane@roe.dev
Built a Google OAuth login flow, going beyond the brief.`);
    expect(parsed.skills).not.toContain('Go');
  });

  it('uses the end of an education date range as the graduation year, not later numbers', () => {
    const parsed = parseResumeText(`ANITA RAO
+91 98765 43210 | anita@mail.com | anitarao.dev | x.com/anitarao
EDUCATION
VIT Vellore Aug. 2024 – May 2028
BTECH - Computer Science and Engineering
EXPERIENCE
Acme Labs acme.io | GitHub Jan. 2025 – Mar. 2025
Backend Intern
• Designed REST APIs in Node.js and PostgreSQL, cutting p95 latency by 30% across
the billing service.
• Shipped a Redis cache.
PROJECTS
Planner | planner.app | GitHub
• Next.js app used by 2030 students.`);
    expect(parsed.name).toBe('Anita Rao');
    expect(parsed.phone).toBe('+91 98765 43210');
    expect(parsed.linkMap.portfolio).toBe('https://anitarao.dev');
    expect(parsed.linkMap.x).toBe('https://x.com/anitarao');
    expect(parsed.education).toMatchObject({ institution: 'VIT Vellore', startYear: 2024, graduationYear: 2028 });
    expect(parsed.education?.degree).toMatch(/^BTECH/);
    const [work, project] = parsed.experience!;
    expect(work).toMatchObject({ kind: 'work', company: 'Acme Labs', role: 'Backend Intern', dates: 'Jan. 2025 – Mar. 2025' });
    expect(work.bullets).toHaveLength(2);
    expect(work.bullets[0]).toContain('across the billing service.');
    expect(project).toMatchObject({ kind: 'project', role: 'Planner' });
  });
});
