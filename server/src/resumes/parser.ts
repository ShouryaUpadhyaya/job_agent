import * as pdfParseModule from 'pdf-parse';

export interface ParsedResume {
  name: string;
  email?: string;
  phone?: string;
  links?: string[];
  skills: string[];
  education?: {
    institution?: string;
    degree?: string;
    graduationYear?: number;
  };
  experience?: Array<{
    role?: string;
    company?: string;
    bullets?: string[];
  }>;
  rawText: string;
}

// Canonical skills dictionary for tech roles
const KNOWN_SKILLS = [
  'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'C#', 'Golang', 'Go', 'Rust', 'Ruby',
  'React', 'Next.js', 'Vue.js', 'Node.js', 'Express', 'NestJS', 'Django', 'FastAPI', 'Flask', 'Spring Boot',
  'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'SQLite', 'Prisma', 'GraphQL', 'REST APIs',
  'Docker', 'Kubernetes', 'AWS', 'GCP', 'Azure', 'Linux', 'Git', 'CI/CD', 'GitHub Actions',
  'WebSockets', 'Kafka', 'Microservices', 'Distributed Systems', 'Tailwind CSS', 'HTML', 'CSS',
  'Vitest', 'Jest', 'Playwright', 'Puppeteer', 'Unit Testing', 'Integration Testing',
];

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const mod: any = pdfParseModule;
  if (typeof mod === 'function') {
    const data = await mod(buffer);
    return data.text || '';
  }
  if (mod?.default && typeof mod.default === 'function') {
    const data = await mod.default(buffer);
    return data.text || '';
  }
  if (mod?.PDFParse) {
    const parser = new mod.PDFParse({ data: buffer });
    await parser.load();
    const result = await parser.getText();
    return typeof result === 'string' ? result : (result?.text || '');
  }
  return '';
}


export function parseResumeText(rawText: string): ParsedResume {
  const clean = (rawText || '').trim();
  const lines = clean.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  // 1. Extract Email
  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i;
  const emailMatch = clean.match(emailRegex);
  const email = emailMatch ? emailMatch[1] : undefined;

  // 2. Extract Phone
  const phoneRegex = /(?:(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4})/;
  const phoneMatch = clean.match(phoneRegex);
  const phone = phoneMatch ? phoneMatch[0] : undefined;

  // 3. Extract Links
  const links: string[] = [];
  const linkRegex = /(https?:\/\/[^\s]+|github\.com\/[^\s]+|linkedin\.com\/in\/[^\s]+)/gi;
  const linkMatches = clean.match(linkRegex);
  if (linkMatches) {
    links.push(...linkMatches);
  }

  // 4. Extract Candidate Name
  // Heuristic: First prominent non-header line that doesn't contain @ or http
  let name = 'Candidate';
  for (const line of lines.slice(0, 5)) {
    if (!line.includes('@') && !line.includes('http') && line.length < 50 && !/resume|curriculum vitae/i.test(line)) {
      name = line.replace(/[^a-zA-Z\s.]/g, '').trim();
      if (name.length > 2) break;
    }
  }

  // 5. Extract Skills
  const matchedSkills = new Set<string>();
  const lowerText = clean.toLowerCase();

  for (const skill of KNOWN_SKILLS) {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|[^a-zA-Z0-9+#])${escaped}(?:$|[^a-zA-Z0-9+#])`, 'i');
    if (regex.test(lowerText) || lowerText.includes(skill.toLowerCase())) {
      matchedSkills.add(skill);
    }
  }

  // 6. Extract Education & Graduation Year
  let institution = undefined;
  let degree = undefined;
  let graduationYear: number | undefined = undefined;

  const gradYearMatches = clean.match(/\b(202[4-9]|203[0-5])\b/g);
  if (gradYearMatches && gradYearMatches.length > 0) {
    const years = gradYearMatches.map((y) => parseInt(y, 10));
    graduationYear = Math.max(...years);
  }


  for (const line of lines) {
    if (/bachelor|b\.tech|b\.s\.|master|m\.tech|m\.s\.|degree/i.test(line)) {
      degree = line;
      break;
    }
  }

  for (const line of lines) {
    if (/university|institute|college|vit |iit |nit |stanford|berkeley|cmu/i.test(line)) {
      institution = line;
      break;
    }
  }

  // 7. Extract Experience / Project Bullets
  const experience: ParsedResume['experience'] = [];
  const bulletLines = lines.filter((l) => /^[-•*]|\b(?:developed|implemented|designed|built|optimized|engineered)\b/i.test(l));
  if (bulletLines.length > 0) {
    experience.push({
      role: 'Project / Experience Highlights',
      bullets: bulletLines.slice(0, 10),
    });
  }

  return {
    name,
    email,
    phone,
    links: links.length > 0 ? links : undefined,
    skills: Array.from(matchedSkills),
    education: {
      institution,
      degree,
      graduationYear,
    },
    experience: experience.length > 0 ? experience : undefined,
    rawText: clean,
  };
}
