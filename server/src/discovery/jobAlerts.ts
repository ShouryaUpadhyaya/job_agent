/**
 * Job-alert email parsing. LinkedIn and Naukri jobs enter Job Agent only this way (plus manual
 * paste): the alert emails these sites send to the user's own inbox are parsed locally; no
 * request is ever made to their sites.
 */
import { RawJobPayload } from '../connectors/types';
import { cleanHtml } from '../connectors/utils';
import { processAndUpsertJob } from '../jobs/normalization';
import { ensureActiveProfile, getProfileResumes } from '../lib/profile';

export type AlertSite = 'linkedin' | 'naukri' | 'internshala' | 'wellfound' | 'instahyre';

export interface AlertEmail {
  from: string;
  subject?: string;
  html?: string | null;
  text?: string | null;
  receivedAt?: Date | string | null;
}

interface SiteRule {
  site: AlertSite;
  label: string;
  senderRe: RegExp;
  /** Finds the job in a (decoded) link; returns [externalId, canonicalUrl]. */
  match: (url: URL) => [string, string] | null;
}

const RULES: SiteRule[] = [
  {
    site: 'linkedin',
    label: 'LinkedIn',
    senderRe: /@([a-z0-9-]+\.)*linkedin\.com\b/i,
    match: (u) => {
      if (!/(^|\.)linkedin\.com$/i.test(u.hostname)) return null;
      const m = u.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/i);
      const id = m?.[1] || u.searchParams.get('currentJobId');
      return id && /^\d{6,}$/.test(id) ? [id, `https://www.linkedin.com/jobs/view/${id}/`] : null;
    },
  },
  {
    site: 'naukri',
    label: 'Naukri',
    senderRe: /@([a-z0-9-]+\.)*naukri\.com\b/i,
    match: (u) => {
      if (!/(^|\.)naukri\.com$/i.test(u.hostname)) return null;
      const m = u.pathname.match(/^\/job-listings-([a-z0-9-]+?)-(\d{9,})\/?$/i);
      return m ? [m[2], `https://www.naukri.com/job-listings-${m[1]}-${m[2]}`] : null;
    },
  },
  {
    site: 'internshala',
    label: 'Internshala',
    senderRe: /@([a-z0-9-]+\.)*internshala\.com\b/i,
    match: (u) => {
      if (!/(^|\.)internshala\.com$/i.test(u.hostname)) return null;
      const m = u.pathname.match(/^\/(internship|job)\/detail\/([a-z0-9-]+?)\/?$/i);
      return m ? [m[2], `https://internshala.com/${m[1].toLowerCase()}/detail/${m[2]}/`] : null;
    },
  },
  {
    site: 'wellfound',
    label: 'Wellfound',
    senderRe: /@([a-z0-9-]+\.)*(wellfound\.com|angel\.co|angellist\.com)\b/i,
    match: (u) => {
      if (!/(^|\.)(wellfound\.com|angel\.co)$/i.test(u.hostname)) return null;
      const m = u.pathname.match(/\/jobs\/(\d{4,})(-[a-z0-9-]*)?\/?$/i);
      return m ? [m[1], `https://wellfound.com/jobs/${m[1]}${m[2] || ''}`] : null;
    },
  },
  {
    site: 'instahyre',
    label: 'Instahyre',
    senderRe: /@([a-z0-9-]+\.)*instahyre\.com\b/i,
    match: (u) => {
      if (!/(^|\.)instahyre\.com$/i.test(u.hostname)) return null;
      const m = u.pathname.match(/^\/job-(\d{3,})(-[a-z0-9-]*)?\/?$/i);
      return m ? [m[1], `https://www.instahyre.com/job-${m[1]}${m[2] || ''}/`] : null;
    },
  },
];

export function detectAlertSite(from: string, body: string): SiteRule | null {
  const bySender = RULES.find((r) => r.senderRe.test(from || ''));
  if (bySender) return bySender;
  // Forwarded alerts: fall back to whichever site's job links appear in the body.
  return RULES.find((r) => links(body).some((l) => r.match(l))) || null;
}

function decodeEntitiesInHref(href: string): string {
  return href.replace(/&amp;/g, '&').replace(/&#x3D;|&#61;/gi, '=').replace(/&#x2F;/gi, '/').trim();
}

function tryUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** The link itself plus any URL embedded in its query (click-tracking redirects). */
function candidateUrls(href: string): URL[] {
  const out: URL[] = [];
  const u = tryUrl(decodeEntitiesInHref(href));
  if (!u) return out;
  out.push(u);
  for (const value of u.searchParams.values()) {
    if (/^https?:\/\//i.test(value)) {
      const inner = tryUrl(value);
      if (inner) out.push(inner);
    }
  }
  return out;
}

function links(body: string): URL[] {
  const out: URL[] = [];
  const re = /https?:\/\/[^\s"'<>)]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.push(...candidateUrls(m[0]));
  return out;
}

const CTA_RE = /^(view (job|details|all|more|internship)s?|apply( now)?|easy apply|see (all )?(jobs|more)|save|share|more jobs?|unsubscribe|search (other|more) jobs|view similar jobs|apply on company site|be an early applicant|actively recruiting|promoted|new|top applicant|\d+ applicants?|\d+ (connections?|alumni|school alumni).*|.*(days?|hours?|weeks?) ago|posted .*|job alert.*|manage alerts?|reply)$/i;
const NOISE_RE = /^(₹|rs\.?|stipend|salary|ctc|\$|apply by|duration|start date|skills?:|experience:|openings?:)/i;
const LOCATION_HINT_RE = /\b(remote|hybrid|on-?site|work from home|india|bengaluru|bangalore|hyderabad|pune|mumbai|delhi|gurgaon|gurugram|noida|chennai|kolkata|ahmedabad|jaipur|kochi|chandigarh|indore|[a-z]+,\s*[a-z]+)\b/i;

function htmlToLines(html: string): string[] {
  return cleanHtml(html.replace(/<\/(td|tr|table|h\d|a)>/gi, '$&<br>'))
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

interface Group {
  id: string;
  url: string;
  anchorTexts: string[];
  start: number;
  end: number;
}

function splitCompanyLocation(lines: string[]): { company?: string; location?: string; extras: string[] } {
  const useful = lines.filter((l) => !CTA_RE.test(l) && l.length <= 160);
  let company: string | undefined;
  let location: string | undefined;
  const extras: string[] = [];
  for (const line of useful) {
    if (NOISE_RE.test(line)) {
      extras.push(line);
      continue;
    }
    const parts = line.split(/\s+[·•|]\s+/).map((p) => p.trim()).filter(Boolean);
    if (!company) {
      company = parts[0];
      if (parts[1] && !location) location = parts.slice(1).join(', ');
      continue;
    }
    if (!location && (LOCATION_HINT_RE.test(line) || parts.length > 1)) {
      location = parts.join(', ');
      continue;
    }
    extras.push(line);
  }
  return { company, location, extras: extras.slice(0, 6) };
}

function parseHtml(html: string, rule: SiteRule): any[] {
  const anchorRe = /<a\b[^>]*?href\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
  const groups: Group[] = [];
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[2] ?? m[3] ?? '';
    let found: [string, string] | null = null;
    for (const u of candidateUrls(href)) {
      found = rule.match(u);
      if (found) break;
    }
    if (!found) continue;
    const [id, url] = found;
    const text = cleanHtml(m[4]).replace(/\s+/g, ' ').trim();
    const last = groups[groups.length - 1];
    if (last && last.id === id) {
      if (text) last.anchorTexts.push(text);
      last.end = m.index + m[0].length;
    } else if (groups.some((g) => g.id === id)) {
      // A later repeat of an earlier job (e.g. "view similar jobs" footer); ignore.
      continue;
    } else {
      groups.push({ id, url, anchorTexts: text ? [text] : [], start: m.index, end: m.index + m[0].length });
    }
  }

  const results: any[] = [];
  groups.forEach((g, i) => {
    const nextStart = i + 1 < groups.length ? groups[i + 1].start : Math.min(html.length, g.end + 3000);
    const title = g.anchorTexts.filter((t) => !CTA_RE.test(t) && t.length >= 3).sort((a, b) => b.length - a.length)[0];
    if (!title) return;
    const tail = htmlToLines(html.slice(g.start, nextStart)).filter((l) => l !== title && !g.anchorTexts.includes(l));
    const { company, location, extras } = splitCompanyLocation(tail);
    if (!company) return;
    results.push({ externalId: g.id, url: g.url, title, company, location, extras });
  });
  return results;
}

function parseText(text: string, rule: SiteRule): any[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const results: any[] = [];
  const seen = new Set<string>();
  lines.forEach((line, i) => {
    for (const u of links(line)) {
      const found = rule.match(u);
      if (!found || seen.has(found[0])) continue;
      // Up to 4 non-empty lines above the link: title, company, location.
      const above: string[] = [];
      for (let j = i - 1; j >= 0 && above.length < 4; j--) {
        const l = lines[j].replace(/^(view job|apply):?\s*$/i, '');
        if (!l) {
          if (above.length) break;
          continue;
        }
        if (/https?:\/\//.test(l)) break;
        above.unshift(l);
      }
      const inline = line.replace(/https?:\/\/\S+/g, '').replace(/^(view job|apply)\s*:?\s*/i, '').trim();
      const block = [...above, ...(inline ? [inline] : [])].filter((l) => !CTA_RE.test(l));
      if (block.length < 2) continue;
      const [title, ...rest] = block;
      const { company, location, extras } = splitCompanyLocation(rest);
      if (!company) continue;
      seen.add(found[0]);
      results.push({ externalId: found[0], url: found[1], title, company, location, extras });
    }
  });
  return results;
}

/**
 * Parses a job-alert email from LinkedIn, Naukri, Internshala, Wellfound or Instahyre into
 * raw listings (source "email:<site>"). Pure: no I/O. Returns [] for other emails.
 */
export function parseJobAlertEmail(email: AlertEmail): RawJobPayload[] {
  const html = email.html || '';
  const text = email.text || '';
  const rule = detectAlertSite(email.from || '', html || text);
  if (!rule) return [];

  let parsed = html ? parseHtml(html, rule) : [];
  if (!parsed.length && text) parsed = parseText(text, rule);

  const received = email.receivedAt ? new Date(email.receivedAt) : null;
  const receivedValid = received && !isNaN(received.getTime()) ? received : undefined;

  return parsed.map((job: any): RawJobPayload => {
    // Internshala alert titles are just the field ("Web Development").
    const internshalaInternship = rule.site === 'internshala' && job.url.includes('/internship/');
    if (internshalaInternship && !/intern/i.test(job.title)) job.title = `${job.title} Internship`;
    const description = [
      `${job.title} at ${job.company}${job.location ? ` (${job.location})` : ''}.`,
      ...(job.extras || []),
      `From a ${rule.label} job-alert email${email.subject ? ` ("${email.subject.trim()}")` : ''}${
        receivedValid ? ` received ${receivedValid.toISOString().slice(0, 10)}` : ''
      }. Open the link for the full description.`,
    ].join('\n');
    return {
      externalId: job.externalId,
      source: `email:${rule.site}`,
      title: job.title,
      company: job.company,
      url: job.url,
      description,
      location: job.location,
      publishedAt: receivedValid,
      tags: [rule.label, 'Job alert email'],
      employmentType: internshalaInternship ? 'INTERNSHIP' : undefined,
    };
  });
}

/** Parses an alert email and upserts its listings (scored against the active profile). */
export async function ingestJobAlertEmail(email: AlertEmail) {
  const payloads = parseJobAlertEmail(email);
  if (!payloads.length) return { parsed: 0, created: 0, updated: 0, jobIds: [] as string[] };
  const profile = await ensureActiveProfile();
  const resumes = await getProfileResumes(profile.id);
  let created = 0;
  let updated = 0;
  const jobIds: string[] = [];
  for (const payload of payloads) {
    const { listing, isNew } = await processAndUpsertJob(payload, profile, resumes);
    jobIds.push(listing.id);
    if (isNew) created++;
    else updated++;
  }
  return { parsed: payloads.length, created, updated, jobIds };
}
