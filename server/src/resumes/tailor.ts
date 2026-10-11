import { CandidateProfile, JobListing } from '@prisma/client';

export interface TailoredResumeResult {
  headline: string;
  matchedSkills: string[];
  missingKeywords: string[];
  highlightedBullets: string[];
  formattedMarkdown: string;
}

export interface TailoredCoverLetterResult {
  recipient: string;
  subject: string;
  salutation: string;
  body: string;
  signoff: string;
  formattedMarkdown: string;
}

export function tailorResume(
  profile: CandidateProfile,
  job: JobListing
): TailoredResumeResult {
  const jobText = `${job.title} ${job.description}`.toLowerCase();
  const candidateSkills = profile.skills || [];

  // 1. Classify matched vs missing
  const matchedSkills: string[] = [];
  const unmatchedCandidateSkills: string[] = [];

  for (const skill of candidateSkills) {
    if (jobText.includes(skill.toLowerCase())) {
      matchedSkills.push(skill);
    } else {
      unmatchedCandidateSkills.push(skill);
    }
  }

  // Common keywords in job that candidate might have or need to emphasize
  const potentialKeywords = [
    'TypeScript', 'Python', 'React', 'Node.js', 'PostgreSQL', 'Docker',
    'GraphQL', 'AWS', 'Kubernetes', 'CI/CD', 'WebSockets', 'Redis',
    'Distributed Systems', 'Microservices', 'RESTful APIs',
  ];
  const missingKeywords = potentialKeywords.filter(
    (kw) => jobText.includes(kw.toLowerCase()) && !matchedSkills.some((s) => s.toLowerCase() === kw.toLowerCase())
  );

  // 2. Synthesize prioritized bullet points
  const highlightedBullets: string[] = [
    `Engineered responsive and scalable full-stack features utilizing ${matchedSkills.slice(0, 3).join(', ') || 'modern web technologies'}, improving reliability and user experience.`,
    `Architected robust backend services and data models with ${matchedSkills.find((s) => /sql|postgres|database/i.test(s)) || 'PostgreSQL'} and REST APIs, ensuring high test coverage and strict validation.`,
    `Streamlined continuous integration and developer workflows using Git and containerized local environments (Docker/Linux).`,
  ];

  if (job.title.toLowerCase().includes('intern')) {
    highlightedBullets.unshift(
      `Accelerated computer science coursework and hands-on projects, targeting full-time 2027 internship contributions with strong foundational skills in ${matchedSkills.slice(0, 2).join(' and ') || 'software engineering'}.`
    );
  }

  // 3. Render clean Markdown format (compatible with ATS exporters)
  const prioritizedSkills = [...matchedSkills, ...unmatchedCandidateSkills];
  const formattedMarkdown = `# ${profile.name} — Tailored Resume for ${job.company}
**Target Role:** ${job.title} | **Email:** ${profile.email || 'candidate@example.com'}

---

### Core Competencies & Technical Skills
- **Direct ATS Skill Matches:** ${matchedSkills.length > 0 ? matchedSkills.join(', ') : 'Software Engineering Fundamentals'}
- **Supporting Stack:** ${unmatchedCandidateSkills.slice(0, 8).join(', ')}
${missingKeywords.length > 0 ? `- **Targeted Role Keywords:** ${missingKeywords.join(', ')}\n` : ''}

### Relevant Experience & Impact
${highlightedBullets.map((b) => `- ${b}`).join('\n')}

### Education
- **Degree:** ${(profile.education as any)?.degree || 'B.Tech Computer Science'}
- **Institution:** ${(profile.education as any)?.institution || 'VIT Vellore'}
- **Graduation Year:** ${(profile.education as any)?.graduationYear || profile.targetGradYear || 2028}
`;

  return {
    headline: `${job.title} at ${job.company}`,
    matchedSkills,
    missingKeywords,
    highlightedBullets,
    formattedMarkdown,
  };
}

export function tailorCoverLetter(
  profile: CandidateProfile,
  job: JobListing
): TailoredCoverLetterResult {
  const topSkills = (profile.skills || []).slice(0, 4).join(', ');
  const company = job.company;
  const title = job.title;

  const subject = `Application for ${title} — ${profile.name}`;
  const salutation = `Dear ${company} Hiring Team,`;

  const body = `I am writing to express my strong enthusiasm for the ${title} position at ${company}. As a Computer Science undergraduate graduating in ${profile.targetGradYear || 2028} with hands-on proficiency in ${topSkills}, I have closely followed ${company}'s technical innovations and would love the opportunity to contribute directly to your engineering team.

In my recent projects and coursework, I have designed and deployed high-throughput backend services, built intuitive web applications, and implemented resilient API integrations. For example, when building distributed systems, I focus on clean architecture, comprehensive test suites, and observable, fail-safe data pipelines—principles that closely match ${company}'s high engineering standards.

The opportunity to apply my skills in ${topSkills} toward ${company}'s mission is exceptionally compelling. I am eager to bring my curiosity, strong work ethic, and passion for reliable software craftsmanship to your team.

Thank you for your time and consideration. I welcome the opportunity to discuss how my background aligns with ${company}'s goals.`;

  const signoff = `Sincerely,\n${profile.name}\n${profile.email || ''}`;

  const formattedMarkdown = `# Cover Letter — ${profile.name}
**To:** ${company} Hiring Team  
**Re:** ${subject}  
**Date:** ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}

---

${salutation}

${body}

${signoff}
`;

  return {
    recipient: `${company} Hiring Team`,
    subject,
    salutation,
    body,
    signoff,
    formattedMarkdown,
  };
}
