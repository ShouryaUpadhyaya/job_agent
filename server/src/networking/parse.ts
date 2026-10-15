/**
 * Validation and light parsing of what the user pastes for a contact. Nothing here fetches
 * anything: LinkedIn/X URLs are only checked for shape and normalised.
 */
import { Persona } from './constants';

export type ValidationResult = { ok: true; value: string | null } | { ok: false; error: string };

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** linkedin.com/in/<slug> → https://www.linkedin.com/in/<slug> */
export function normalizeLinkedinUrl(raw: unknown): ValidationResult {
  const v = clean(raw);
  if (!v) return { ok: true, value: null };
  const m = v.match(/^(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([^/?#\s]+)\/?(?:[?#].*)?$/i);
  if (!m) return { ok: false, error: 'LinkedIn URL must look like https://www.linkedin.com/in/<profile>' };
  let slug = m[1];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    /* keep raw */
  }
  if (!/^[\p{L}\p{N}_-]{2,100}$/u.test(slug)) return { ok: false, error: 'LinkedIn profile slug looks invalid' };
  return { ok: true, value: `https://www.linkedin.com/in/${encodeURIComponent(slug.toLowerCase())}` };
}

const X_RESERVED = new Set(['home', 'search', 'i', 'intent', 'share', 'explore', 'notifications', 'messages', 'settings', 'hashtag', 'login']);

/** x.com/<handle>, twitter.com/<handle> or @handle → https://x.com/<handle> */
export function normalizeXUrl(raw: unknown): ValidationResult {
  const v = clean(raw);
  if (!v) return { ok: true, value: null };
  const m =
    v.match(/^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?(?:[?#].*)?$/i) ||
    v.match(/^@([A-Za-z0-9_]{1,15})$/);
  if (!m || X_RESERVED.has(m[1].toLowerCase())) {
    return { ok: false, error: 'X URL must look like https://x.com/<handle>' };
  }
  return { ok: true, value: `https://x.com/${m[1]}` };
}

/** github.com/<login> → https://github.com/<login> */
export function normalizeGithubUrl(raw: unknown): ValidationResult {
  const v = clean(raw);
  if (!v) return { ok: true, value: null };
  const m = v.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/?(?:[?#].*)?$/i);
  if (!m) return { ok: false, error: 'GitHub URL must look like https://github.com/<user>' };
  return { ok: true, value: `https://github.com/${m[1]}` };
}

export function normalizeEmail(raw: unknown): ValidationResult {
  const v = clean(raw);
  if (!v) return { ok: true, value: null };
  if (v.length > 254 || !/^[^\s@<>()]+@[^\s@<>()]+\.[A-Za-z]{2,}$/.test(v)) {
    return { ok: false, error: 'Email address looks invalid' };
  }
  return { ok: true, value: v.toLowerCase() };
}

const PERSONA_RULES: [Persona, RegExp][] = [
  ['FOUNDER_CXO', /\b(co-?founder|founder|ceo|cto|coo|cpo|chief [a-z]+ officer)\b/i],
  ['RECRUITER', /\b(recruit\w*|talent|sourc(er|ing)|hr|human resources|people partner|people ops|campus hiring|hiring partner)\b/i],
  ['MANAGER', /\b(manager|director|head of|vp|vice president|engineering lead)\b/i],
  ['FULLSTACK', /\bfull[\s-]?stack\b/i],
  ['ENGINEER', /\b(engineer\w*|developer|dev|sde|swe|programmer|architect|devops|sre|data scientist|ml|backend|frontend|front-end|back-end|tech lead|mts)\b/i],
];

export function inferPersona(text: string | null | undefined): Persona {
  const t = (text || '').trim();
  if (!t) return 'OTHER';
  for (const [persona, re] of PERSONA_RULES) if (re.test(t)) return persona;
  return 'OTHER';
}

export function mentionsVit(text: string | null | undefined): boolean {
  return /\bVIT\b|vellore institute of technology|\bVITian\b/i.test(text || '');
}

/** Only VIT is recognised (the user's school); other schools are left for the user to type. */
export function inferSchool(text: string | null | undefined): string | null {
  const t = text || '';
  if (!mentionsVit(t)) return null;
  const campus = t.match(/\bVIT[\s-]*(Chennai|AP|Andhra Pradesh|Bhopal|Amaravati)\b/i);
  if (campus) return `VIT ${campus[1].replace(/andhra pradesh|amaravati/i, 'AP')}`;
  return 'VIT Vellore';
}

export interface HeadlineGuess {
  role: string | null;
  company: string | null;
  persona: Persona;
  school: string | null;
  vitAlumni: boolean;
}

/**
 * "SDE-2 @ Razorpay | VIT Vellore '21" → role "SDE-2", company "Razorpay", persona ENGINEER,
 * school "VIT Vellore". Guesses only; the UI lets the user correct every field.
 */
export function parseHeadline(text: string | null | undefined): HeadlineGuess {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  const first = t.split(/\s[|•·]\s|\s-\s|\s–\s/)[0] || '';
  let role: string | null = null;
  let company: string | null = null;
  const at = first.match(/^(.*?)\s+(?:@|at)\s+(.+)$/i);
  if (at) {
    role = at[1].trim() || null;
    company = at[2].replace(/[,;].*$/, '').trim() || null;
  } else if (first) {
    role = first.trim();
  }
  if (role && role.length > 100) role = role.slice(0, 100);
  if (company && (company.length > 80 || mentionsVit(company))) company = null;
  const school = inferSchool(t);
  return { role, company, persona: inferPersona(`${role || ''} ${t}`), school, vitAlumni: Boolean(school) };
}

/** First name for a greeting; "there" when the name doesn't look like a person's name. */
export function firstNameOf(name: string | null | undefined): string {
  const n = (name || '').replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n || /\b(engineer|recruiter|manager|team|talent|partner|hr|careers|jobs|hiring)\b/i.test(n)) return 'there';
  const parts = n.split(' ').filter((p) => !/^(dr|mr|mrs|ms|prof)\.?$/i.test(p));
  const first = parts[0] || '';
  if (!/^[\p{L}][\p{L}'.-]*$/u.test(first) || first.length < 2) return 'there';
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}
