import { extractSkills, textHasSkill, canonicalSkillName } from './skills';

export type Classification = 'APPLY' | 'REVIEW' | 'SKIP';

export type MatchResult = {
  score: number;
  classification: Classification;
  /** Short, user-facing "why matched" chips. */
  reasons: string[];
  matchedSkills: string[];
  missingSkills: string[];
  disqualifications: string[];
  eligibilityConcerns: string[];
};

export interface MatchOptions {
  /** Force (or disable) intern/entry-level seniority checks; default: inferred from the profile. */
  enforceSeniorityConstraint?: boolean;
  targetGraduationYear?: number;
  preferredLocations?: string[];
  remoteOk?: boolean;
  /** Reference time for freshness (tests). */
  now?: Date;
}

/** The profile fields the engine reads. Prisma's CandidateProfile satisfies it. */
export interface MatchProfile {
  skills: string[];
  targetRole?: string | null;
  targetGradYear?: number | null;
  preferredLocations?: string[] | null;
  remoteOk?: boolean | null;
  education?: any;
  experience?: any;
}

export interface MatchJobInput {
  title: string;
  description: string;
  company: string;
  location?: string | null;
  publishedAt?: Date | string | null;
  createdAt?: Date | string | null;
  employmentType?: string | null;
}

export const THRESHOLDS = { APPLY: 60, REVIEW: 35 } as const;

const INTERN_TITLE_RE = /\b(intern|internship|interns|co-?op|trainee|apprentice(ship)?|fresher|freshers|new[- ]grad(uate)?|graduate (engineer|trainee|program(me)?)|campus hire|university grad(uate)?|early career|entry[- ]level|junior|jr\.?|associate software engineer|sde[- ]?(1|i)|software engineer i)(?![a-z])/i;
const INTERN_DESC_RE = /\b(internship|intern|interns|freshers?|new grads?|recent graduates?|final[- ]year students?|pre[- ]final[- ]year|graduating (students|in)|students? (graduating|pursuing)|campus (hiring|placement)|pre[- ]placement offer|ppo|entry[- ]level|0\s*[-–to]+\s*[12]\s*years?)\b/i;
const ENTRY_TARGET_RE = /\b(intern|internship|fresher|new grad|graduate|entry|junior|trainee|student|campus)\b/i;

// Title words that mean "not for an intern/fresher". "II"/"III" are matched case-sensitively below.
const SENIOR_TITLE_RE = /\b(senior|sr\.?|staff|principal|lead|leader|manager|director|head of|vp|vice president|architect|distinguished|fellow|chief|expert|specialist ii|sde[- ]?(2|3|ii|iii|iv)|swe[- ]?(2|3|ii|iii)|l[4-9]|level\s*[3-9]|e[4-9]|mts\s*(2|3|ii|iii))\b/i;
const ROMAN_LEVEL_RE = /(?:^|\s)(II|III|IV|V)(?:\s|$|,|\))/;

const ROLE_CATEGORIES: [string, RegExp][] = [
  ['backend', /\b(back[- ]?end|server[- ]side|api|platform|infrastructure|distributed)\b/i],
  ['fullstack', /\b(full[- ]?stack)\b/i],
  ['frontend', /\b(front[- ]?end|ui engineer|web developer|react developer)\b/i],
  ['mobile', /\b(android|ios|mobile|flutter)\b/i],
  ['devops', /\b(devops|sre|site reliability|cloud|infra(structure)?|platform)\b/i],
  ['data', /\b(data|ml|machine learning|ai|analytics)\b/i],
  ['software', /\b(software|sde|swe|developer|programmer|engineer)\b/i],
];
const ENGINEERING_TITLE_RE = /\b(engineer(ing)?|developer|sde|swe|programmer|software|devops|sre|data scientist|ml|technolog(y|ist))\b/i;

const INDIA_PLACES = [
  'india', 'bengaluru', 'bangalore', 'hyderabad', 'pune', 'mumbai', 'navi mumbai', 'chennai', 'delhi', 'new delhi',
  'ncr', 'gurgaon', 'gurugram', 'noida', 'kolkata', 'ahmedabad', 'jaipur', 'kochi', 'trivandrum', 'thiruvananthapuram',
  'coimbatore', 'indore', 'chandigarh', 'mohali', 'vellore', 'mysore', 'mysuru', 'bhubaneswar', 'goa', 'karnataka',
  'telangana', 'maharashtra', 'tamil nadu',
];
const REMOTE_RE = /\b(remote|anywhere|worldwide|work from home|wfh|distributed)\b/i;
const REGION_RESTRICTED_REMOTE_RE = /\b(us|usa|united states|u\.s\.|canada|uk|united kingdom|europe|eu|emea|americas|latam|north america|germany|australia|brazil)\b(?![^()]*\b(india|apac|asia|worldwide|anywhere)\b)/i;

const GRAD_CONTEXT_RE = /(graduat|batch|class of|pass(ing)?[- ]?out|cohort|degree|students?|final[- ]year|pre[- ]final|b\.?\s?tech|b\.?e\.?\b|expected to graduate|eligib)/i;

function wordIn(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z])${escaped}(?![a-z])`, 'i').test(text);
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function profileGradYear(profile: MatchProfile, options: MatchOptions): number | null {
  const fromEducation = Number(profile.education?.graduationYear) || null;
  return options.targetGraduationYear ?? profile.targetGradYear ?? fromEducation ?? null;
}

/** Whether the candidate is looking for internships / entry-level roles. */
export function isEntryLevelProfile(profile: MatchProfile, options: MatchOptions = {}, now = new Date()): boolean {
  if (options.enforceSeniorityConstraint !== undefined) return options.enforceSeniorityConstraint;
  if (profile.targetRole && ENTRY_TARGET_RE.test(profile.targetRole)) return true;
  const exp = profile.experience ? JSON.stringify(profile.experience) : '';
  if (/\b(intern|internship|fresher|new grad)/i.test(exp)) return true;
  const grad = profileGradYear(profile, options);
  return grad !== null && grad >= now.getFullYear();
}

/** Minimum years of experience the description asks for, or null. "0-2 years" → 0. */
export function requiredYearsOfExperience(text: string): number | null {
  const re = /(?:(?:minimum|min\.?|at least|over)\s+(?:of\s+)?)?(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*\+?\s*)?(?:years?|yrs?)(?:\s+of)?(?:\s+(?:professional|industry|relevant|hands[- ]on|work(?:ing)?|software|engineering|development|full[- ]time|commercial|proven))*\s+(?:experience|exp\b)/gi;
  let min: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = parseInt(m[1], 10);
    if (n > 30) continue;
    min = min === null ? n : Math.min(min, n);
  }
  // "experience: 3+ years" / "experience of 2 years"
  const re2 = /experience(?:\s*(?:of|:|-))?\s*(\d{1,2})\s*(?:\+|plus)?\s*(?:years?|yrs?)/gi;
  while ((m = re2.exec(text)) !== null) {
    const n = parseInt(m[1], 10);
    if (n <= 30) min = min === null ? n : Math.min(min, n);
  }
  return min;
}

function seniorityInTitle(title: string): string | null {
  const m = title.match(SENIOR_TITLE_RE);
  if (m) return m[0];
  const r = title.match(ROMAN_LEVEL_RE);
  return r ? r[1] : null;
}

/** Years mentioned in a graduation/batch context. */
export function graduationYearsMentioned(text: string): number[] {
  const years = new Set<number>();
  const re = /\b(20[2-3]\d)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const window = text.slice(Math.max(0, m.index - 60), m.index + 60);
    // "Summer 2027 internship" is a start date, not a batch.
    const before = text.slice(Math.max(0, m.index - 12), m.index);
    if (/\b(summer|winter|spring|fall|autumn|starting|from|start|joining|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*$/i.test(before) && !/batch|class of|graduat/i.test(before)) continue;
    if (GRAD_CONTEXT_RE.test(window)) years.add(parseInt(m[1], 10));
  }
  return [...years];
}

function locationAssessment(
  location: string,
  title: string,
  preferred: string[],
  remoteOk: boolean
): { points: number; reason?: string; concern?: string } {
  const loc = location.trim();
  const isRemote = REMOTE_RE.test(loc) || /\bremote\b/i.test(title);
  const prefersIndia = preferred.some((p) => /india/i.test(p));

  for (const p of preferred) {
    if (!p || /^remote$/i.test(p)) continue;
    if (wordIn(loc, p)) return { points: 15, reason: `Location: ${p}` };
  }
  if (prefersIndia && INDIA_PLACES.some((place) => wordIn(loc, place))) {
    return { points: 15, reason: 'Location: India' };
  }
  if (isRemote) {
    if (!remoteOk && !preferred.some((p) => /remote/i.test(p))) return { points: 0 };
    if (REGION_RESTRICTED_REMOTE_RE.test(loc)) {
      return { points: 4, reason: 'Remote (region-restricted)', concern: `Remote role limited to: ${loc}` };
    }
    return { points: 12, reason: 'Remote-friendly' };
  }
  if (!loc || /unspecified|multiple|various/i.test(loc)) return { points: 0 };
  return { points: -10, concern: `Location outside your preferences: ${loc}` };
}

function freshness(job: MatchJobInput, now: Date): { points: number; reason?: string } {
  const posted = toDate(job.publishedAt) ?? toDate(job.createdAt);
  if (!posted) return { points: 0 };
  const days = Math.max(0, (now.getTime() - posted.getTime()) / 86_400_000);
  if (days <= 3) return { points: 5, reason: 'Posted in the last 3 days' };
  if (days <= 7) return { points: 4, reason: 'Posted this week' };
  if (days <= 14) return { points: 2 };
  if (days <= 30) return { points: 0 };
  if (days <= 60) return { points: -5, reason: 'Posted over a month ago' };
  return { points: -10, reason: 'Posted over two months ago' };
}

export function matchJob(profile: MatchProfile, job: MatchJobInput, options: MatchOptions = {}): MatchResult {
  const now = options.now ?? new Date();
  const reasons: string[] = [];
  const disqualifications: string[] = [];
  const eligibilityConcerns: string[] = [];

  const title = job.title || '';
  const description = job.description || '';
  const fullText = `${title}\n${description}`;
  const entryLevel = isEntryLevelProfile(profile, options, now);

  // 1. Skills (max 45): title hits weigh double; coverage = share of the job's stack you have.
  const titleHits: string[] = [];
  const descHits: string[] = [];
  const matchedCanonical = new Set<string>();
  for (const skill of profile.skills || []) {
    if (!skill || !skill.trim()) continue;
    const canonical = canonicalSkillName(skill);
    if (matchedCanonical.has(canonical)) continue;
    if (textHasSkill(title, skill)) {
      titleHits.push(skill);
      matchedCanonical.add(canonical);
    } else if (textHasSkill(description, skill)) {
      descHits.push(skill);
      matchedCanonical.add(canonical);
    }
  }
  const jobSkills = extractSkills(fullText);
  const covered = jobSkills.filter((s) => matchedCanonical.has(s)).length;
  const coverage = jobSkills.length ? covered / jobSkills.length : 0;
  const skillPoints = Math.min(30, titleHits.length * 10 + descHits.length * 5) + Math.round(15 * coverage);
  const matchedSkills = [...titleHits, ...descHits];
  if (matchedSkills.length) {
    reasons.push(`Skills: ${matchedSkills.slice(0, 5).join(', ')}${matchedSkills.length > 5 ? ` +${matchedSkills.length - 5}` : ''}`);
  }
  const missingSkills = jobSkills.filter((s) => !matchedCanonical.has(s)).slice(0, 10);

  // 2. Role relevance (max 25 + 10).
  let rolePoints = 0;
  const internTitle = INTERN_TITLE_RE.test(title) || job.employmentType === 'INTERNSHIP';
  const internDesc = !internTitle && INTERN_DESC_RE.test(description);
  if (entryLevel) {
    if (internTitle) {
      rolePoints += 25;
      reasons.push(/intern/i.test(title) || job.employmentType === 'INTERNSHIP' ? 'Internship role' : 'Entry-level role');
    } else if (internDesc) {
      rolePoints += 12;
      reasons.push('Open to interns/freshers');
    }
  } else if (internTitle && !/intern/i.test(title)) {
    rolePoints += 10;
  }
  const target = `${profile.targetRole || ''}`;
  const titleCategory = ROLE_CATEGORIES.find(([, re]) => re.test(title));
  if (titleCategory) {
    const targetCategory = ROLE_CATEGORIES.find(([, re]) => re.test(target));
    if (targetCategory && targetCategory[0] === titleCategory[0] && titleCategory[0] !== 'software') {
      rolePoints += 10;
      reasons.push(`Matches target role (${titleCategory[0]})`);
    } else if (ENGINEERING_TITLE_RE.test(title)) {
      rolePoints += 6;
    }
  }

  // 3. Seniority / experience.
  const seniority = seniorityInTitle(title);
  const years = requiredYearsOfExperience(description);
  if (entryLevel) {
    if (seniority && !internTitle) {
      disqualifications.push(`Seniority mismatch: "${seniority}" role, but you are targeting internships/entry-level roles.`);
    }
    if (years !== null && years >= 2) {
      if (internTitle) {
        eligibilityConcerns.push(`Mentions ${years}+ years of experience.`);
      } else {
        disqualifications.push(`Experience constraint: requires ${years}+ years of experience.`);
      }
    } else if (years === 1 && !internTitle) {
      eligibilityConcerns.push('Asks for about 1 year of experience.');
    }
  } else if (options.enforceSeniorityConstraint !== false && seniority && /principal|director|vp|vice president|distinguished|fellow|chief|head of/i.test(seniority)) {
    eligibilityConcerns.push(`Very senior role (${seniority}).`);
  }

  // 4. Graduation year (+10 eligible, -25 explicit mismatch).
  let gradPoints = 0;
  const gradYear = profileGradYear(profile, options);
  if (gradYear) {
    const mentioned = graduationYearsMentioned(fullText);
    if (mentioned.length) {
      if (mentioned.some((y) => Math.abs(y - gradYear) <= 1)) {
        gradPoints = 10;
        reasons.push(`Eligible graduation year (${gradYear} batch)`);
      } else {
        gradPoints = -25;
        eligibilityConcerns.push(`Graduation cohort mismatch: listing targets ${mentioned.sort().join('/')} (you: ${gradYear}).`);
      }
    }
  }

  // 5. Location (max 15).
  const preferred = (options.preferredLocations ?? profile.preferredLocations ?? ['India', 'Remote']).filter(Boolean);
  const remoteOk = options.remoteOk ?? profile.remoteOk ?? true;
  const loc = locationAssessment(job.location || '', title, preferred, remoteOk);
  if (loc.reason) reasons.push(loc.reason);
  if (loc.concern) eligibilityConcerns.push(loc.concern);

  // 6. Freshness.
  const fresh = freshness(job, now);
  if (fresh.reason) reasons.push(fresh.reason);

  // 7. Sparse data safeguard.
  if (!description || description.trim().length < 50) {
    eligibilityConcerns.push('Sparse or missing description; qualifications could not be verified.');
  }

  let score = skillPoints + rolePoints + gradPoints + loc.points + fresh.points;
  score = Math.max(0, Math.min(100, Math.round(score)));
  if (disqualifications.length) score = Math.min(score, 15);

  let classification: Classification;
  if (disqualifications.length) {
    classification = 'SKIP';
  } else if (score >= THRESHOLDS.APPLY) {
    const blocking = eligibilityConcerns.some((c) => /cohort mismatch|years of experience|outside your preferences/i.test(c));
    classification = blocking || (eligibilityConcerns.length > 0 && !internTitle) ? 'REVIEW' : 'APPLY';
  } else if (score >= THRESHOLDS.REVIEW) {
    classification = 'REVIEW';
  } else {
    classification = 'SKIP';
  }

  return {
    score,
    classification,
    reasons,
    matchedSkills,
    missingSkills,
    disqualifications,
    eligibilityConcerns,
  };
}
