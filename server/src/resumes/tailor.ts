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

/**
 * Generates an application cover letter using Google Gemini and the candidate writing agent prompt.
 */
export async function tailorCoverLetterWithGemini(
  profile: CandidateProfile,
  job: JobListing,
  question?: string,
  wordLimit?: number
): Promise<TailoredCoverLetterResult> {
  const geminiKey = process.env.GEMINI_KEY;
  if (!geminiKey) {
    return tailorCoverLetter(profile, job);
  }

  const prompt = `You are my job application writing agent. You have access to my resume. Use it as the source of truth for my skills, experience, projects, education, and achievements.

## Task: Generate Tailored Job Application Answer
Generate a concise, personalised answer to the application question "${question || 'What interests you about working for this company?'}" that I can submit directly.

### Inputs
- Company Name: ${job.company}
- Target Role: ${job.title}
- Job Listing & Details: ${job.description}
- Candidate Resume & Profile:
${JSON.stringify(profile, null, 2)}

### Workflow & Rules
1. Extract the company's product domain, engineering challenges, and relevant tech stack from the listing.
2. Ground your response in my actual resume. Identify the 2-3 most relevant skills or projects. Prioritize production experience, measurable impact, and technical ownership.
3. Explain why the role and company's work specifically interests me, connecting it directly to evidence from my experience. Explain what I can contribute and what I want to learn.
4. Style & Length:
   - Target ${wordLimit || '90–130'} words.
   - First-person language ("I"), natural, warm, and professional English.
   - Avoid generic corporate language, clichés, empty praise, and technical keyword lists.
   - Plain text only: NO markdown, NO asterisks (**), NO bullet points, NO placeholder brackets like [Company].
5. Structure:
   - Salutation: "Dear ${job.company} team,"
   - Body: 2 concise paragraphs.
   - Sign-off: "Best regards,\n${profile.name}"
6. Validation: Never invent skills, companies, metrics, experience, or company-specific facts. Every claim must be supported by my CV.

Return ONLY the final application answer ready to submit.`;

  try {
    const models = ['gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
    for (const model of models) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          }
        );
        const data: any = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('').trim();
        if (text && text.length > 50 && !/\[[^\]]{2,40}\]/.test(text)) {
          const cleanText = text.replace(/\*\*|__|^#+\s*/gm, '').trim();
          return {
            recipient: `${job.company} Hiring Team`,
            subject: `Application for ${job.title} — ${profile.name}`,
            salutation: `Dear ${job.company} Hiring Team,`,
            body: cleanText,
            signoff: `Best regards,\n${profile.name}`,
            formattedMarkdown: cleanText,
          };
        }
      } catch (e) {}
    }
  } catch (err) {}

  return tailorCoverLetter(profile, job);
}

/**
 * Generates an answer to custom application questions using Google Gemini and the candidate writing agent prompt.
 */
export async function generateAnswerWithGemini(
  profile: CandidateProfile,
  job: JobListing,
  question: string,
  wordLimit?: number
): Promise<string> {
  const geminiKey = process.env.GEMINI_KEY;
  const prompt = `You are my job application writing agent. You have access to my resume. Use it as the source of truth for my skills, experience, projects, education, and achievements.

## Task: Generate Tailored Application Answer
Generate a concise, direct, personalised answer for this specific application screening question:
"${question}"

### Inputs
- Application Question: "${question}"
- Company Name: ${job.company}
- Target Role: ${job.title}
- Job Listing & Details: ${job.description}
- Word Limit: ${wordLimit ? `${wordLimit} words` : '50–90 words'}
- Candidate Resume & Profile:
${JSON.stringify(profile, null, 2)}

### Workflow & Rules
1. Answer the exact question directly in the opening sentence.
2. Ground the response strictly in my resume. Highlight production systems, architecture, and measurable outcomes.
3. If I lack an exact requested skill, emphasize relevant adjacent transferable experience honestly without making false claims.
4. Style & Length:
   - Target ${wordLimit ? `${wordLimit} words` : '50–90 words'} (or 2-4 direct sentences).
   - Natural, professional, first-person English.
   - Plain text only: NO markdown, NO asterisks, NO bullet points, NO greetings or sign-offs, NO placeholder brackets.
5. Never invent skills, achievements, or metrics.

Return ONLY the final answer.`;

  if (geminiKey) {
    const models = ['gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
    for (const model of models) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          }
        );
        const data: any = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('').trim();
        if (text && text.length > 20 && !/\[[^\]]{2,40}\]/.test(text)) {
          return text.replace(/\*\*|__|^#+\s*/gm, '').trim();
        }
      } catch (e) {}
    }
  }

  return `With my experience in ${(profile.skills || []).slice(0, 3).join(', ')}, I have built and deployed reliable production features and backend services that align directly with this role.`;
}
