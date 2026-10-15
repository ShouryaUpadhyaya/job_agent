import * as pdfParseModule from 'pdf-parse';
import { extractSkills } from '../matching/skills';

export interface ParsedEducation {
  institution?: string;
  degree?: string;
  startYear?: number;
  graduationYear?: number;
  gpa?: string;
}

export interface ParsedExperience {
  kind: 'work' | 'project';
  role?: string;
  company?: string;
  dates?: string;
  bullets: string[];
}

export interface ParsedLinks {
  github?: string;
  linkedin?: string;
  portfolio?: string;
  x?: string;
}

export interface ParsedResume {
  name: string;
  email?: string;
  phone?: string;
  links?: string[];
  linkMap: ParsedLinks;
  skills: string[];
  education?: ParsedEducation;
  experience?: ParsedExperience[];
  rawText: string;
}

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
    const text = typeof result === 'string' ? result : result?.text || '';
    // pdf-parse v2 appends "-- 1 of 2 --" page markers.
    return text.replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm, '');
  }
  return '';
}

// ---------------------------------------------------------------------------
// Sections

type SectionKey = 'education' | 'experience' | 'projects' | 'skills' | 'other';

const SECTION_HEADINGS: Record<string, SectionKey> = {
  education: 'education',
  academics: 'education',
  'academic background': 'education',
  experience: 'experience',
  'work experience': 'experience',
  'professional experience': 'experience',
  employment: 'experience',
  'employment history': 'experience',
  internships: 'experience',
  internship: 'experience',
  projects: 'projects',
  'personal projects': 'projects',
  'academic projects': 'projects',
  'key projects': 'projects',
  skills: 'skills',
  'technical skills': 'skills',
  'skills and interests': 'skills',
  achievements: 'other',
  awards: 'other',
  certifications: 'other',
  'leadership': 'other',
  'positions of responsibility': 'other',
  'extracurricular activities': 'other',
  activities: 'other',
  publications: 'other',
  summary: 'other',
  objective: 'other',
  interests: 'other',
  languages: 'other',
};

function sectionOf(line: string): SectionKey | null {
  const key = line.toLowerCase().replace(/[^a-z& ]/g, '').replace(/&/g, 'and').replace(/\s+/g, ' ').trim();
  if (!key || line.length > 40) return null;
  return SECTION_HEADINGS[key] ?? null;
}

function splitSections(lines: string[]): { header: string[]; sections: Map<SectionKey, string[]> } {
  const header: string[] = [];
  const sections = new Map<SectionKey, string[]>();
  let current: SectionKey | null = null;
  for (const line of lines) {
    const heading = sectionOf(line);
    if (heading) {
      current = heading;
      if (!sections.has(heading)) sections.set(heading, []);
      continue;
    }
    if (current) sections.get(current)!.push(line);
    else header.push(line);
  }
  return { header, sections };
}

// ---------------------------------------------------------------------------
// Dates

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const YEAR = '(?:19|20)\\d{2}';
const DATE = `(?:${MONTH}\\s*)?${YEAR}`;
const RANGE_RE = new RegExp(`(${DATE})\\s*(?:[-–—]|to)\\s*(${DATE}|present|current|now|ongoing)`, 'i');

function yearOf(s: string): number | undefined {
  const m = s.match(/(?:19|20)\d{2}/);
  return m ? parseInt(m[0], 10) : undefined;
}

function stripDates(line: string): { text: string; dates?: string } {
  const m = line.match(RANGE_RE);
  if (m) return { text: clean(line.replace(m[0], ' ')), dates: m[0].replace(/\s+/g, ' ').trim() };
  const single = line.match(new RegExp(`(${MONTH}\\s*${YEAR}|\\b${YEAR}\\b)\\s*$`, 'i'));
  if (single) return { text: clean(line.slice(0, single.index)), dates: single[1] };
  return { text: clean(line) };
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/^[\s|,–—-]+|[\s|,–—-]+$/g, '').trim();
}

// ---------------------------------------------------------------------------
// Contact details

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const URL_RE = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s|,;()]*)?/gi;

function findPhone(text: string): string | undefined {
  const candidates = text.match(/\+?\(?\d[\d\s().-]{8,18}\d/g) || [];
  for (const c of candidates) {
    const digits = c.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 13) continue;
    // Skip year ranges such as "2024 - 2028 2030".
    if (/^(?:19|20)\d{2}\D+(?:19|20)\d{2}/.test(c.trim())) continue;
    return c.trim();
  }
  return undefined;
}

function normaliseUrl(raw: string): string {
  const trimmed = raw.replace(/[.)\]]+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function findLinks(text: string, contactText: string): { links: string[]; linkMap: ParsedLinks } {
  const links: string[] = [];
  const linkMap: ParsedLinks = {};
  const emailDomains = new Set((text.match(new RegExp(EMAIL_RE.source, 'g')) || []).map((e) => e.split('@')[1].toLowerCase()));
  const add = (url: string) => {
    if (!links.includes(url)) links.push(url);
  };

  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0];
    const before = text[m.index! - 1];
    if (before === '@' || emailDomains.has(raw.toLowerCase())) continue;
    const lower = raw.toLowerCase();
    if (/github\.com\/[^/\s]+/.test(lower)) {
      const url = normaliseUrl(raw);
      add(url);
      // The profile link is the first github.com/<user> without a repo path.
      if (!linkMap.github && !/github\.com\/[^/\s]+\/[^/\s]+/.test(lower)) linkMap.github = url;
    } else if (/linkedin\.com\/in\//.test(lower)) {
      const url = normaliseUrl(raw);
      add(url);
      linkMap.linkedin ??= url;
    } else if (/(?:^|\/\/|\.)(?:x|twitter)\.com\/[a-z0-9_]+/.test(lower)) {
      const url = normaliseUrl(raw);
      add(url);
      linkMap.x ??= url;
    } else if (/^https?:\/\//i.test(raw)) {
      add(normaliseUrl(raw));
    }
  }

  // Bare personal domains ("janedoe.dev") only count in the contact header, where they are
  // the portfolio; elsewhere they are usually company or project sites.
  for (const m of contactText.matchAll(URL_RE)) {
    const raw = m[0];
    const lower = raw.toLowerCase();
    if (contactText[m.index! - 1] === '@' || emailDomains.has(lower)) continue;
    if (/(github|linkedin|twitter)\.com|(?:^|\/\/|\.)x\.com/.test(lower)) continue;
    if (/^\d/.test(raw)) continue;
    const url = normaliseUrl(raw);
    add(url);
    linkMap.portfolio ??= url;
  }
  if (!linkMap.portfolio) {
    const other = links.find((l) => !/(github|linkedin|twitter)\.com|\/\/(?:www\.)?x\.com/i.test(l));
    if (other) linkMap.portfolio = other;
  }
  return { links, linkMap };
}

function looksLikeName(s: string): boolean {
  if (!s || s.length > 50 || /\d|@|https?:|www\./i.test(s)) return false;
  if (/resume|curriculum vitae|\bcv\b/i.test(s)) return false;
  const words = s.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w));
}

function titleCaseIfShouting(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_m, p, c) => p + c.toUpperCase());
}

function findName(lines: string[]): string {
  for (const line of lines.slice(0, 6)) {
    if (sectionOf(line)) break;
    const first = clean(line.split(/\s*[|•·]\s*|\s{3,}/)[0] || '');
    if (looksLikeName(first)) return titleCaseIfShouting(first);
  }
  return 'Candidate';
}

// ---------------------------------------------------------------------------
// Education

const INSTITUTION_RE = /universit|institute|college|school of|academy|\b(?:VIT|IIT|NIT|IIIT|BITS)\b|stanford|berkeley|\bMIT\b|\bCMU\b/i;
const DEGREE_WORD_RE = /bachelor|master|degree|diploma/i;
const DEGREE_ABBR_RE = /\b(?:B\.?\s?Tech|BTECH|M\.?\s?Tech|MTECH|B\.E\.|B\.S\.|M\.S\.|B\.?Sc|M\.?Sc|BCA|MCA|MBA|Ph\.?D)(?![A-Za-z])/;
const isDegree = (line: string) => DEGREE_WORD_RE.test(line) || DEGREE_ABBR_RE.test(line);

function parseEducation(sectionLines: string[] | undefined, allLines: string[], text: string): ParsedEducation {
  const lines = sectionLines?.length ? sectionLines : allLines;
  const edu: ParsedEducation = {};

  for (const line of lines) {
    if (!edu.institution && INSTITUTION_RE.test(line)) {
      const { text: name, dates } = stripDates(line);
      edu.institution = name;
      if (dates) {
        const range = dates.match(RANGE_RE);
        if (range) {
          edu.startYear = yearOf(range[1]);
          if (!/present|current|now|ongoing/i.test(range[2])) edu.graduationYear = yearOf(range[2]);
        }
      }
    }
    if (!edu.degree && isDegree(line) && !/^\s*[-•*]/.test(line)) {
      edu.degree = stripDates(line).text;
    }
    const gpa = line.match(/\b(?:c?gpa|cpi)\s*[:\-]?\s*(\d{1,2}(?:\.\d{1,2})?\s*(?:\/\s*\d{1,2}(?:\.\d+)?)?)/i);
    if (!edu.gpa && gpa) edu.gpa = gpa[1].replace(/\s+/g, '');
  }

  if (!edu.graduationYear) {
    // A date range in the education section ends with the graduation year.
    for (const line of sectionLines || []) {
      const range = line.match(RANGE_RE);
      if (range && !/present|current|now|ongoing/i.test(range[2])) {
        edu.graduationYear = yearOf(range[2]);
        edu.startYear ??= yearOf(range[1]);
        break;
      }
    }
  }
  if (!edu.graduationYear) {
    const explicit = text.match(new RegExp(`(?:expected|graduat\\w*|class of|batch of|passing out)[^\\n]{0,25}?(${YEAR})`, 'i'));
    if (explicit) edu.graduationYear = parseInt(explicit[1], 10);
  }
  if (!edu.graduationYear) {
    const years = ((sectionLines?.length ? sectionLines.join('\n') : text).match(/\b(?:19|20)\d{2}\b/g) || []).map(Number);
    if (years.length) edu.graduationYear = Math.max(...years);
  }
  return edu;
}

// ---------------------------------------------------------------------------
// Experience & projects

const BULLET_RE = /^\s*[-•*▪●◦‣–]\s*/;

function parseEntries(lines: string[] | undefined, kind: 'work' | 'project'): ParsedExperience[] {
  if (!lines?.length) return [];
  const entries: { header: string[]; bullets: string[] }[] = [];
  let current: { header: string[]; bullets: string[] } | null = null;

  for (const line of lines) {
    if (BULLET_RE.test(line)) {
      if (!current) {
        current = { header: [], bullets: [] };
        entries.push(current);
      }
      current.bullets.push(line.replace(BULLET_RE, '').trim());
      continue;
    }
    if (current && current.bullets.length) {
      const last = current.bullets[current.bullets.length - 1];
      const isHeader = RANGE_RE.test(line) || /\s\|\s/.test(line) || /[.!]$/.test(last);
      if (!isHeader) {
        current.bullets[current.bullets.length - 1] = `${last} ${line}`;
        continue;
      }
      current = { header: [line], bullets: [] };
      entries.push(current);
      continue;
    }
    if (!current) {
      current = { header: [], bullets: [] };
      entries.push(current);
    }
    current.header.push(line);
  }

  return entries
    .filter((e) => e.header.length || e.bullets.length)
    .map((e) => {
      let dates: string | undefined;
      const headers = e.header.map((h) => {
        const s = stripDates(h);
        if (s.dates && !dates) dates = s.dates;
        return s.text;
      });
      // "Moss X mossx.in | GitHub" → "Moss X": drop link labels and bare domains.
      const first = (headers[0] || '')
        .split(/\s+\|\s+/)[0]
        .replace(/\s+(?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\S*$/i, '')
        .trim();
      if (kind === 'project') {
        return { kind, role: first || 'Project', company: undefined, dates, bullets: e.bullets };
      }
      // Common layouts: "Company … dates" then "Role", or "Role at Company".
      const at = first.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
      if (at) return { kind, role: at[1], company: at[2], dates, bullets: e.bullets };
      return { kind, company: first || undefined, role: headers[1]?.split(/\s+\|\s+/)[0].trim() || undefined, dates, bullets: e.bullets };
    });
}

function highlightBullets(lines: string[]): ParsedExperience[] {
  const bullets = lines.filter((l) => BULLET_RE.test(l) || /\b(?:developed|implemented|designed|built|optimized|engineered)\b/i.test(l));
  if (!bullets.length) return [];
  return [{ kind: 'work', role: 'Project / Experience Highlights', bullets: bullets.slice(0, 10).map((b) => b.replace(BULLET_RE, '').trim()) }];
}

// ---------------------------------------------------------------------------

export function parseResumeText(rawText: string): ParsedResume {
  const text = (rawText || '').replace(/\r\n?/g, '\n').trim();
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const { header, sections } = splitSections(lines);
  const contactText = (header.length ? header : lines.slice(0, 4)).join('\n');

  const email = text.match(EMAIL_RE)?.[0];
  const phone = findPhone(contactText) ?? findPhone(text);
  const { links, linkMap } = findLinks(text, contactText);

  const education = parseEducation(sections.get('education'), lines, text);

  let experience = [
    ...parseEntries(sections.get('experience'), 'work'),
    ...parseEntries(sections.get('projects'), 'project'),
  ];
  if (!experience.length) experience = highlightBullets(lines);

  return {
    name: findName(lines),
    email,
    phone,
    links: links.length ? links : undefined,
    linkMap,
    skills: extractSkills(text),
    education,
    experience: experience.length ? experience : undefined,
    rawText: text,
  };
}
