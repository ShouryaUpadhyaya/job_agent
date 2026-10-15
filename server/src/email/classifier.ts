/**
 * Rule-based classifier for job-search email. Order matters:
 *   job alerts → LinkedIn accepts → rejection → offer → assessment → interview →
 *   application confirmation → referral → recruiter outreach → follow-up → fallback.
 * Job alerts are checked first because digests routinely contain words like "interview",
 * "offer" and "next steps". Rejections come before offers/interviews because rejections often
 * mention both ("we will not be moving forward to the interview stage").
 *
 * The company comes from the subject/body/sender name, never from an ATS or job-site sender
 * domain (no-reply@us.greenhouse-mail.io is Greenhouse, not the employer).
 */
import { parseHeadline } from '../networking/parse';
import { parseFrom, senderDomain } from './mime';

export const CLASSIFICATIONS = [
  'APPLICATION_CONFIRMATION',
  'ASSESSMENT',
  'INTERVIEW_INVITATION',
  'REJECTION',
  'OFFER',
  'RECRUITER_OUTREACH',
  'REFERRAL_RESPONSE',
  'LINKEDIN_CONNECTION_ACCEPTED',
  'FOLLOW_UP_REQUIRED',
  'JOB_ALERT',
  'UNRELATED',
  'UNKNOWN',
] as const;
export type ComprehensiveClassification = (typeof CLASSIFICATIONS)[number];
export type Importance = 'HIGH' | 'NORMAL' | 'LOW';

export function isClassification(v: unknown): v is ComprehensiveClassification {
  return typeof v === 'string' && (CLASSIFICATIONS as readonly string[]).includes(v);
}

export interface ClassificationResult {
  classification: ComprehensiveClassification;
  confidence: number;
  importance: Importance;
  explanation: string;
  suggestedAction: string;
  company?: string;
  role?: string;
  extractedPerson?: string;
  /** Deadline phrase found in the email, e.g. "within 48 hours" or "by Oct 20". */
  deadline?: string;
  /** True when the sender is an automated mailbox (no-reply, notifications, ATS). */
  automatedSender: boolean;
}

export interface EmailMetadataInput {
  subject: string;
  body?: string;
  /** Address or full From header. */
  sender?: string;
  senderName?: string;
}

// ---------------------------------------------------------------------------------------------
// Sender knowledge

/** ATS, assessment and job-site domains: the sender domain says nothing about the employer. */
export const PLATFORM_DOMAINS = [
  'greenhouse.io',
  'greenhouse-mail.io',
  'lever.co',
  'myworkday.com',
  'myworkdayjobs.com',
  'workday.com',
  'ashbyhq.com',
  'smartrecruiters.com',
  'workablemail.com',
  'workable.com',
  'icims.com',
  'jobvite.com',
  'taleo.net',
  'successfactors.com',
  'bamboohr.com',
  'recruitee.com',
  'breezy.hr',
  'zohorecruit.com',
  'zoho.com',
  'freshteam.com',
  'keka.com',
  'darwinbox.in',
  'darwinbox.com',
  'naukri.com',
  'internshala.com',
  'instahyre.com',
  'wellfound.com',
  'angel.co',
  'angellist.com',
  'linkedin.com',
  'indeed.com',
  'glassdoor.com',
  'cutshort.io',
  'hirist.com',
  'hirist.tech',
  'iimjobs.com',
  'foundit.in',
  'hackerrank.com',
  'hackerrankforwork.com',
  'hackerearth.com',
  'codesignal.com',
  'codility.com',
  'mettl.com',
  'mercer-mettl.com',
  'unstop.com',
  'hirepro.in',
  'superset.com',
  'joinsuperset.com',
  'calendly.com',
  'goodtime.io',
];

const PERSONAL_DOMAINS = ['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'proton.me', 'protonmail.com', 'rediffmail.com'];

const PLATFORM_NAMES = /^(greenhouse|lever|workday|ashby|smartrecruiters|workable|icims|jobvite|naukri|naukri\.com|internshala|instahyre|wellfound|angellist|linkedin|indeed|glassdoor|hackerrank|hackerearth|codesignal|codility|mettl|unstop|cutshort|hirist|foundit|google|gmail|calendly)$/i;

export function domainMatches(domain: string, list: string[]): boolean {
  const d = domain.toLowerCase();
  return list.some((x) => d === x || d.endsWith('.' + x));
}

export function isPlatformDomain(domain: string): boolean {
  return domainMatches(domain, PLATFORM_DOMAINS);
}

export function isPersonalDomain(domain: string): boolean {
  return domainMatches(domain, PERSONAL_DOMAINS);
}

const AUTOMATED_LOCAL =
  /^(no-?reply|do-?not-?reply|donotreply|noreply[\w.-]*|[\w.-]*-noreply|notifications?|notify|mailer(-daemon)?|alerts?|jobalerts?|job-?alerts?|jobs-listings|messages-noreply|invitations|updates|news(letter)?|info|support|hello|team|careers|jobs|recruiting|recruitment|talent|talentacquisition|hr|hiring|apply|applications?|campus|university|people|system|automated|bounce|digest)$/i;

/** Mailboxes no human replies from (and role mailboxes that aren't a person). */
export function isAutomatedSender(email: string, senderName?: string | null): boolean {
  const addr = (email || '').toLowerCase();
  const local = addr.split('@')[0] || '';
  if (AUTOMATED_LOCAL.test(local) || /no-?reply|do-?not-?reply/.test(local)) return true;
  if (isPlatformDomain(senderDomain(addr))) return true;
  if (senderName && /\b(no-?reply|notifications?|team|recruiting|careers|talent acquisition|jobs|alerts?|hiring)\b/i.test(senderName)) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------
// Company / role / person / deadline extraction

const SKIP_COMPANY = new Set(
  [
    'applying', 'application', 'applications', 'interview', 'interviews', 'update', 'updates', 'offer', 'invitation', 'your', 'you',
    'the', 'our', 'us', 'we', 'team', 'hiring', 'software', 'engineer', 'engineering', 'intern', 'internship', 'role', 'position',
    'job', 'jobs', 'opportunity', 'next', 'thank', 'thanks', 'regarding', 're', 'fwd', 'fw', 'important', 'action', 'assessment',
    'congratulations', 'hello', 'hi', 'dear', 'candidate', 'online', 'coding', 'test', 'invite', 'reminder', 'new', 'a', 'an',
    'this', 'that', 'it', 'more', 'all', 'please',
  ]
);

const COMPANY_TOKEN = /^[ \t]*(?:the[ \t]+)?([A-Z0-9][\w&'’.+-]*(?:[ \t]+(?:[A-Z0-9&][\w&'’.+-]*|of|and|de|&)){0,3})/;

function cleanCompany(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  let c = raw
    .replace(/[’']s$/, '')
    .replace(/[.,!:;|)\]]+$/, '')
    .replace(/\s+(of|and|de|&)$/i, '')
    .trim();
  // Drop trailing role-ish/ATS words ("Razorpay Careers", "Stripe Recruiting Team").
  c = c.replace(/\s+(careers|recruiting|recruitment|talent(\s+acquisition)?|hiring|hr|team|university|campus|jobs|people|via\b.*)$/i, '').trim();
  c = c.replace(/\s+(careers|recruiting|recruitment|talent|hiring|team|university|campus)$/i, '').trim();
  if (!c || c.length < 2 || c.length > 60) return undefined;
  if (SKIP_COMPANY.has(c.toLowerCase())) return undefined;
  if (PLATFORM_NAMES.test(c)) return undefined;
  if (/^\d/.test(c) && (!/^\d+[A-Za-z]{2,}/.test(c) || /^\d+(:\d+)?\s*(am|pm|st|nd|rd|th|days?|hours?)\b/i.test(c))) return undefined;
  const first = c.split(/\s+/)[0].toLowerCase();
  if (SKIP_COMPANY.has(first)) return undefined;
  return c;
}

/** Company name at the start of `rest` (case-sensitive capitalised run). */
function companyAt(rest: string): string | undefined {
  const m = rest.match(COMPANY_TOKEN);
  return m ? cleanCompany(m[1]) : undefined;
}

/** Phrases after which the company name follows. Case-insensitive phrase, case-sensitive name. */
const COMPANY_AFTER: RegExp[] = [
  /\b(?:role|position|internship|opening|job|opportunity|program(?:me)?|team|intern|engineer|developer)\s+(?:at|with)\s+/gi,
  /\byour application (?:was sent|has been sent|was submitted|has been submitted) to\s+/gi,
  /\bapplication (?:to|at|with)\s+/gi,
  /\bthank(?:s| you) for (?:applying|your application|your interest)(?:\s+(?:to|at|with|in))\s+/gi,
  /\binterest in (?:joining |working at |a role at |a position at |an? (?:internship|role|position|opportunity) at )?/gi,
  /\b(?:applying|applied) (?:to|at|with)\s+/gi,
  /\binterview(?:ing)? (?:at|with)\s+/gi,
  /\b(?:update|news|message) from\s+/gi,
  /\bopportunit(?:y|ies) (?:at|with)\s+/gi,
  /\bjoin(?:ing)?\s+(?:the\s+)?(?:team at\s+)?/gi,
  /\bwelcome to\s+/gi,
  /\bhiring (?:team|process) at\s+/gi,
  /\s+at\s+/gi,
];

/** "Swiggy has invited you to …", "Acme would like to invite you …" */
const COMPANY_BEFORE = /(?:^|[\n.!:]\s*|\b)([A-Z][\w&'’.+-]*(?:[ \t]+[A-Z][\w&'’.+-]*){0,2})[ \t]+(?:has|have)[ \t]+invited you\b/;

function companyFromText(text: string): string | undefined {
  if (!text) return undefined;
  const before = text.match(COMPANY_BEFORE);
  if (before) {
    const c = cleanCompany(before[1]);
    if (c) return c;
  }
  for (const re of COMPANY_AFTER) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const c = companyAt(text.slice((m.index ?? 0) + m[0].length));
      if (c) return c;
    }
  }
  return undefined;
}

function companyFromSubjectShape(subject: string): string | undefined {
  // "Razorpay | Application received", "Cloudflare: Invitation to Interview", "[Stripe] Your application"
  const bracket = subject.match(/\[([^\]]{2,40})\]/);
  if (bracket) {
    const c = cleanCompany(bracket[1]);
    if (c) return c;
  }
  const lead = subject.match(/^(?:(?:re|fwd?):\s*)*([A-Z0-9][\w&'’.+ -]{1,40}?)\s*[|:–—-]\s+\S/);
  if (lead) {
    const c = cleanCompany(lead[1]);
    if (c && c.split(/\s+/).length <= 4) return c;
  }
  return undefined;
}

function companyFromSignature(body: string): string | undefined {
  const m =
    body.match(/\b(?:the\s+)?([A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,2})\s+(?:Recruiting|Talent Acquisition|Talent|Hiring|Careers|University Recruiting|Campus Recruiting|People|HR)\s+Team\b/) ||
    body.match(/\bTeam\s+([A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,2})\s*$/m);
  return m ? cleanCompany(m[1]) : undefined;
}

function companyFromSenderName(name: string | undefined | null, domain: string): string | undefined {
  if (!name) return undefined;
  // "Acme Corp via Greenhouse", "Stripe Recruiting", "Cloudflare University Talent", "Workday @ Atlassian"
  const at = name.match(/@\s*([A-Z][\w&.' -]+)$/);
  if (at) return cleanCompany(at[1]);
  const via = name.match(/^(.+?)\s+(?:via|through)\s+/i);
  const base = (via ? via[1] : name).trim();
  const hasRoleWord = /\b(recruiting|recruitment|talent|careers|hiring|hr|university|campus|team|jobs|people)\b/i.test(base);
  // A bare person name ("Priya Sharma") is not a company.
  if (!via && !hasRoleWord && !isPlatformDomain(domain) && base.split(/\s+/).length <= 3 && /^[A-Z][a-z]+(\s+[A-Z][a-z]+)+$/.test(base)) {
    return undefined;
  }
  if (!via && !hasRoleWord) return undefined;
  const stripped = base.replace(/\b(university|campus|talent acquisition|talent|recruiting|recruitment|careers|hiring|hr|team|jobs|people)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  return cleanCompany(stripped);
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Registrable label of a domain: mail.cloudflare.com → cloudflare, foo.co.in → foo. */
export function domainLabel(domain: string): string {
  const parts = domain.toLowerCase().split('.').filter(Boolean);
  if (parts.length < 2) return parts[0] || '';
  const sld = parts[parts.length - 2];
  if (['co', 'com', 'org', 'net', 'ac', 'gov'].includes(sld) && parts.length >= 3) return parts[parts.length - 3];
  return sld;
}

function companyFromSender(email: string): string | undefined {
  const domain = senderDomain(email);
  if (!domain) return undefined;
  if (domainMatches(domain, ['myworkday.com', 'myworkdayjobs.com'])) {
    // Workday sends from <tenant>@myworkday.com.
    const local = email.split('@')[0];
    if (local && !AUTOMATED_LOCAL.test(local) && !/workday/i.test(local)) return titleCase(local.replace(/[^a-z0-9]/gi, ''));
    return undefined;
  }
  if (isPlatformDomain(domain) || isPersonalDomain(domain)) return undefined;
  const label = domainLabel(domain);
  return label && label.length >= 2 ? titleCase(label) : undefined;
}

export function extractCompany(input: { subject: string; body: string; email: string; senderName?: string | null }): string | undefined {
  const head = input.body.slice(0, 3000);
  return (
    companyFromText(input.subject) ||
    companyFromSubjectShape(input.subject) ||
    companyFromText(head) ||
    companyFromSignature(head) ||
    companyFromSenderName(input.senderName, senderDomain(input.email)) ||
    companyFromSender(input.email)
  );
}

const ROLE_NOUN =
  /\b((?:(?:Senior|Junior|Associate|Graduate|Summer|Winter|Lead|Staff|Principal|Trainee)\s+)?(?:[A-Z][\w+#/.-]*\s+){0,4}(?:Engineer(?:ing)?|Developer|Intern(?:ship)?|Scientist|Analyst|Architect|SDE|SWE)(?:\s+(?:Intern(?:ship)?|I{1,3}|[1-3]))?(?:\s*\((?:[^)]{1,30})\))?)/;

export function extractRole(subject: string, body: string): string | undefined {
  const sources = [subject, body.slice(0, 2000)];
  for (const s of sources) {
    const structured =
      s.match(/\b(?:for|as)\s+(?:the|an?|our)\s+(.{3,70}?)\s+(?:role|position|internship|opening|job)\b/i) ||
      s.match(/\bapplication for\s+(?:the\s+)?(.{3,70}?)\s+(?:role|position)?\s*(?:at|with)\s+[A-Z]/i) ||
      s.match(/\b(?:applying|applied) (?:for|to) (?:the\s+)?(.{3,70}?)\s+(?:role|position|internship)?\s*(?:at|with)\s+[A-Z]/i);
    if (structured) {
      const r = structured[1].replace(/\s+(role|position)$/i, '').trim();
      if (r && !/^(this|that|a|an|the)$/i.test(r) && /[A-Za-z]/.test(r)) return r.slice(0, 100);
    }
    const noun = s.match(ROLE_NOUN);
    if (noun) return noun[1].trim().slice(0, 100);
  }
  return undefined;
}

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DATE_TEXT = `(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\\s+)?(?:${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}(?:,?\\s+\\d{4})?|\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?)(?:,?\\s+(?:at\\s+)?\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?(?:\\s*(?:ist|utc|gmt|pst|pdt|est|edt))?)?`;
const DEADLINE_RES: RegExp[] = [
  new RegExp(`\\b(?:complete(?:d)?|submit(?:ted)?|finish(?:ed)?|respond|reply|accept)\\s+(?:it\\s+|this\\s+|the\\s+\\w+\\s+)?(?:by|before|no later than)\\s+${DATE_TEXT}`, 'i'),
  new RegExp(`\\b(?:deadline|due(?: date)?|expires?(?: on)?|valid (?:until|till)|closes? on)\\s*(?:is|:|-)?\\s*${DATE_TEXT}`, 'i'),
  new RegExp(`\\b(?:by|before|no later than)\\s+${DATE_TEXT}`, 'i'),
  /\b(?:within|in the next)\s+\d+\s*(?:hours?|hrs?|days?|business days|calendar days|working days)\b/i,
  /\b(?:by|before)\s+(?:end of (?:day|the week)|eod|tomorrow|today|this (?:friday|week))\b/i,
];

export function extractDeadline(text: string | null | undefined): string | undefined {
  const t = (text || '').slice(0, 6000);
  for (const re of DEADLINE_RES) {
    const m = t.match(re);
    if (m) return m[0].replace(/\s+/g, ' ').trim();
  }
  return undefined;
}

export function extractLinkedInPerson(subject: string, body: string): string | undefined {
  const re = /^(?:re:\s*)?(.+?)\s+(?:has\s+)?(?:accepted your (?:invitation|connection request)|is now a connection)/i;
  const m = subject.match(re) || body.match(/(?:^|\n)\s*(.+?)\s+(?:has\s+)?accepted your (?:invitation|connection request)/i);
  if (m && m[1]) {
    const name = m[1].replace(/^(you and|congrats[,!]?)\s+/i, '').trim();
    if (name && name.length <= 80) return name;
  }
  const now = (subject + '\n' + body).match(/you and (.+?) are now connected/i);
  return now ? now[1].trim() : undefined;
}

/** LinkedIn accept emails show the person's headline right below their name. */
function linkedInPersonCompany(body: string, person: string): string | undefined {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const idx = lines.findIndex((l) => l.toLowerCase() === person.toLowerCase());
  const candidates = idx >= 0 ? lines.slice(idx + 1, idx + 3) : [];
  const paren = body.match(new RegExp(`${person.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(([^)]{3,120})\\)`));
  if (paren) candidates.unshift(paren[1]);
  for (const line of candidates) {
    const guess = parseHeadline(line);
    if (guess.company) return cleanCompany(guess.company.split(/\s[|•·]\s/)[0]) || undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Rules

const has = (re: RegExp, text: string) => re.test(text);

const ALERT_SENDER = /^(jobalerts?(-noreply)?|job-?alerts?|jobs-listings|alerts?|jobalert|recommendations?|digest)@|@(alerts?|jobalerts?)\./i;
const ALERT_SUBJECT =
  /\b(job alert|jobs? alert|new jobs? (for you|matching|in|near)|jobs? (matching|recommended|for you|you may be interested in|based on your)|recommended (jobs|internships|for you)|\d+\+?\s+new (jobs|internships|opportunities|openings)|internships? (alert|for you|matching|recommended)|top (jobs|internships|picks)|job recommendations|jobs digest|daily digest|weekly digest|(is|are) hiring|apply now to|similar jobs|still hiring|trending jobs|profile matches?)\b/i;
const PERSONAL_SUBJECT =
  /\b(your application|thank(s| you) for applying|application (received|submitted|confirmation|status)|interview (invitation|invite|request|schedul)|offer letter|assessment|coding (test|challenge)|accepted your (invitation|connection))\b/i;

const LINKEDIN_ACCEPT = /\b(accepted your (invitation|connection request)|is now a connection|are now connected)\b/i;

const REJECTION_STRONG =
  /\b(not (be )?(moving|move) forward|decided (not to (proceed|move forward|progress)|to (move|proceed|go) forward with other)|move forward with other (candidates|applicants)|pursu(e|ing) other (candidates|applicants)|(have|has) not been selected|were not selected|not been shortlisted|(won'?t|will not) be (moving|proceeding|progressing|advancing|taking)|unable to (offer you|move forward|proceed with your)|regret to inform|position has (now )?been filled|no longer (under consideration|being considered|considering)|not (a|the right) (fit|match) (at this time|for this role)|decided to go with (another|other) candidates?|application (was|has been) (unsuccessful|declined|rejected)|not able to (offer|progress|move forward))\b/i;
const REJECTION_WEAK = /\bunfortunately\b[^.]{0,120}\b(application|candidacy|position|role|profile|opportunity)\b/i;

const OFFER =
  /\b(offer of employment|offer letter|(pleased|delighted|excited|happy|thrilled) to (extend|offer) (you )?(an?|the|this) (offer|position|role|internship)|(pleased|delighted|excited|happy|thrilled) to offer you|extend(ing)? (you )?an offer|congratulations[!,.]?\s+(on your offer|you('| ha)ve (been selected|received an offer)|we('| a)re (pleased|delighted|excited))|you have been (hired|selected for the (role|position|internship))|accept (the|this|your) offer|offer (details|package|acceptance))\b/i;

const ASSESSMENT =
  /\b(online assessment|coding (challenge|test|assessment|round|exercise)|technical (assessment|test|challenge)|take[- ]home (assignment|assessment|challenge|exercise|task|test)|assessment (link|invitation|invite)|complete (the|your|this|an?) (online |coding |technical )?(assessment|test|challenge)|invited (you )?to (take|complete) (an?|the|this)|aptitude test|hackerrank (test|assessment|challenge)|codesignal (assessment|test|gca)|hiring (test|assessment))\b/i;
const ASSESSMENT_PLATFORM = /\b(hackerrank|hackerearth|codesignal|codility|mettl|testgorilla|imocha|coderbyte|karat)\b/i;
const ASSESSMENT_PLATFORM_DOMAINS = ['hackerrank.com', 'hackerrankforwork.com', 'hackerearth.com', 'codesignal.com', 'codility.com', 'mettl.com', 'mercer-mettl.com'];

const INTERVIEW =
  /\b(interview (invitation|invite|request|schedul\w*|slot|confirmation|details|round|call|availability)|invit\w* (you )?(to|for) (an?|the|your)?\s*(interview|technical (screen|discussion|round)|phone screen|chat|conversation)|schedul\w* (an?|your|the) (interview|call|chat|technical|phone|conversation|screen)|phone screen|technical (screen|interview|discussion|round)|(your )?availability (for|to)|calendly\.com|goodtime\.io|cal\.com\/|pick a (time|slot)|book a (time|slot)|select a (time|slot)|interview with (our|the)|next round|hiring manager (call|chat|round)|(first|second|final|onsite|virtual) (round|interview))\b/i;
const INTERVIEW_SUBJECT = /\binterview\b/i;

const CONFIRMATION =
  /\b(thank(s| you) for (applying|your application|submitting your application)|application (has been |was )?(received|submitted)|(we('ve| have)|have) received your (application|submission|resume)|received your application|your application (was|has been) (sent|submitted|received)|successfully (applied|submitted)|application confirmation|we got your application|you applied (for|to))\b/i;
const INTEREST_THANKS = /\bthank(s| you) for your interest\b/i;

const REFERRAL =
  /\b(referred you|submitted (a|your|the) referral|happy to refer|i('ve| have) (just )?referred|referral (has been )?(submitted|done|sent)|you('ve| have) been referred|put in a referral|refer(red)? your (profile|resume))\b/i;

const OUTREACH =
  /\b(came across your (profile|resume|github|portfolio)|impressed (by|with) your (background|profile|experience|work)|(think|thought|believe) you (might|would|could) be a (great |good |strong )?fit|reaching out (regarding|about|to see|because)|exciting (opportunity|role)|are you open to|interested in exploring|i('m| am) (a |the )?(technical |tech )?recruiter|i('m| am) hiring for|we('re| are) (currently )?hiring for|would you be (open|interested)|your profile (stood out|caught my eye))\b/i;

const FOLLOW_UP =
  /\b(action required|please (confirm|reply|respond|share|send|provide|complete|fill|update|upload|let us know)|kindly (confirm|share|fill|provide|submit|reply)|awaiting your (response|reply)|documents? required|could you (please )?(share|send|confirm|provide)|let (me|us) know (if|when|your)|following up on|gentle reminder|reminder:)\b/i;

const JOB_WORDS = /\b(application|interview|recruit\w*|hiring|position|role|internship|candidate|resume|job|career|offer|referral)\b/i;

const IMPORTANCE: Record<ComprehensiveClassification, Importance> = {
  INTERVIEW_INVITATION: 'HIGH',
  ASSESSMENT: 'HIGH',
  OFFER: 'HIGH',
  RECRUITER_OUTREACH: 'HIGH',
  REFERRAL_RESPONSE: 'HIGH',
  FOLLOW_UP_REQUIRED: 'HIGH',
  APPLICATION_CONFIRMATION: 'NORMAL',
  REJECTION: 'NORMAL',
  LINKEDIN_CONNECTION_ACCEPTED: 'NORMAL',
  JOB_ALERT: 'LOW',
  UNRELATED: 'LOW',
  UNKNOWN: 'LOW',
};

export function importanceFor(c: ComprehensiveClassification): Importance {
  return IMPORTANCE[c];
}

const ACTIONS: Record<ComprehensiveClassification, string> = {
  APPLICATION_CONFIRMATION: 'Application tracked as APPLIED in the pipeline; nothing to do until they reply.',
  ASSESSMENT: 'Check the assessment duration and deadline, then block time to take it.',
  INTERVIEW_INVITATION: 'Reply with your availability or pick a slot, then prepare for the round.',
  REJECTION: 'Marked REJECTED where allowed; note any feedback and move on.',
  OFFER: 'Review compensation, start date and the acceptance deadline.',
  RECRUITER_OUTREACH: 'Reply within a day if the role interests you; the sender is saved in Networking.',
  REFERRAL_RESPONSE: 'Thank the referrer and apply through the referral link if they sent one.',
  LINKEDIN_CONNECTION_ACCEPTED: 'Send a thank-you and referral ask from Networking.',
  FOLLOW_UP_REQUIRED: 'They asked for something; reply or complete the requested step.',
  JOB_ALERT: 'Listings from this alert were added to Job Discovery.',
  UNRELATED: 'No action needed.',
  UNKNOWN: 'Open the email to check whether it needs a reply.',
};

const EXPLANATIONS: Record<ComprehensiveClassification, string> = {
  APPLICATION_CONFIRMATION: 'Confirmation that an application was received.',
  ASSESSMENT: 'Invitation to an online/take-home assessment.',
  INTERVIEW_INVITATION: 'Invitation to schedule or attend an interview.',
  REJECTION: 'The company is not moving forward with the application.',
  OFFER: 'Offer of employment or internship.',
  RECRUITER_OUTREACH: 'A recruiter or hiring manager reached out about a role.',
  REFERRAL_RESPONSE: 'Response to a referral request.',
  LINKEDIN_CONNECTION_ACCEPTED: 'A LinkedIn connection request was accepted.',
  FOLLOW_UP_REQUIRED: 'The sender is waiting on a reply or an action from you.',
  JOB_ALERT: 'Automated job-alert digest.',
  UNRELATED: 'Not related to the job search.',
  UNKNOWN: 'Could not classify this email with confidence.',
};

export function suggestedActionFor(c: ComprehensiveClassification, deadline?: string): string {
  const base = ACTIONS[c];
  return deadline && ['ASSESSMENT', 'INTERVIEW_INVITATION', 'OFFER', 'FOLLOW_UP_REQUIRED'].includes(c) ? `${base} Deadline: ${deadline}.` : base;
}

function result(
  classification: ComprehensiveClassification,
  confidence: number,
  ctx: { company?: string; role?: string; person?: string; deadline?: string; automated: boolean; reason?: string }
): ClassificationResult {
  const deadline = ['ASSESSMENT', 'INTERVIEW_INVITATION', 'OFFER', 'FOLLOW_UP_REQUIRED'].includes(classification) ? ctx.deadline : undefined;
  const parts = [EXPLANATIONS[classification]];
  if (ctx.reason) parts.push(`Matched: ${ctx.reason}.`);
  if (deadline) parts.push(`Deadline: ${deadline}.`);
  return {
    classification,
    confidence: Math.min(0.99, Math.round(confidence * 100) / 100),
    importance: IMPORTANCE[classification],
    explanation: parts.join(' '),
    suggestedAction: suggestedActionFor(classification, deadline),
    company: ctx.company,
    role: ctx.role,
    extractedPerson: ctx.person,
    deadline,
    automatedSender: ctx.automated,
  };
}

function matchText(re: RegExp, text: string): string | undefined {
  const m = text.match(re);
  return m ? m[0].toLowerCase() : undefined;
}

/**
 * Classifies one email. `sender` may be an address or a full From header; `senderName` is
 * parsed from it when not given.
 */
export function classifyJobEmail(input: EmailMetadataInput): ClassificationResult {
  const subject = (input.subject || '').trim();
  const body = input.body || '';
  const from = parseFrom(input.sender || '');
  const email = from.email;
  const senderName = input.senderName ?? from.name;
  const domain = senderDomain(email);
  const automated = isAutomatedSender(email, senderName);
  const text = `${subject}\n${body}`;
  const head = `${subject}\n${body.slice(0, 4000)}`;

  const company = extractCompany({ subject, body, email, senderName });
  const role = extractRole(subject, body);
  const deadline = extractDeadline(body || subject);
  const ctx = { company, role, deadline, automated };
  const isLinkedIn = domainMatches(domain, ['linkedin.com']);

  // 1. Job alerts / digests.
  const alertSender = ALERT_SENDER.test(email);
  const alertSubject = ALERT_SUBJECT.test(subject);
  if (alertSender || (alertSubject && (automated || isPlatformDomain(domain)) && !PERSONAL_SUBJECT.test(subject) && !LINKEDIN_ACCEPT.test(subject))) {
    return result('JOB_ALERT', alertSender ? 0.95 : isPlatformDomain(domain) ? 0.9 : 0.75, {
      ...ctx,
      company: undefined,
      role: undefined,
      reason: alertSender ? 'job-alert sender' : matchText(ALERT_SUBJECT, subject),
    });
  }

  // 2. LinkedIn connection accepted.
  if (LINKEDIN_ACCEPT.test(head) && (isLinkedIn || /linkedin/i.test(text))) {
    const person = extractLinkedInPerson(subject, body);
    const personCompany = person ? linkedInPersonCompany(body, person) : undefined;
    return result('LINKEDIN_CONNECTION_ACCEPTED', isLinkedIn ? 0.97 : 0.8, {
      ...ctx,
      company: personCompany,
      role: undefined,
      person,
      reason: 'connection accepted',
    });
  }

  // 3. Rejection.
  const rej = matchText(REJECTION_STRONG, text);
  if (rej || (REJECTION_WEAK.test(text) && !CONFIRMATION.test(text))) {
    return result('REJECTION', rej ? 0.95 : 0.75, { ...ctx, reason: rej || 'unfortunately … application' });
  }

  // 4. Offer.
  const offer = matchText(OFFER, head);
  if (offer) return result('OFFER', 0.92, { ...ctx, reason: offer });

  // 5. Assessment.
  const assess = matchText(ASSESSMENT, head);
  const assessPlatform = domainMatches(domain, ASSESSMENT_PLATFORM_DOMAINS) || ASSESSMENT_PLATFORM.test(head);
  if (assess || (assessPlatform && /\b(invit\w*|test|assessment|challenge)\b/i.test(head))) {
    return result('ASSESSMENT', assess ? 0.93 : 0.8, { ...ctx, reason: assess || 'assessment platform' });
  }

  // 6. Interview.
  const interview = matchText(INTERVIEW, head);
  if (interview) return result('INTERVIEW_INVITATION', 0.9, { ...ctx, reason: interview });
  if (INTERVIEW_SUBJECT.test(subject) && !CONFIRMATION.test(text)) {
    return result('INTERVIEW_INVITATION', 0.7, { ...ctx, reason: 'interview in subject' });
  }

  // 7. Application confirmation.
  const confirm = matchText(CONFIRMATION, head);
  if (confirm) return result('APPLICATION_CONFIRMATION', 0.93, { ...ctx, reason: confirm });
  if (INTEREST_THANKS.test(head) && automated) {
    return result('APPLICATION_CONFIRMATION', 0.7, { ...ctx, reason: 'thank you for your interest' });
  }

  // 8. Referral response.
  const referral = matchText(REFERRAL, head);
  if (referral) return result('REFERRAL_RESPONSE', 0.88, { ...ctx, reason: referral });
  if (/^re:/i.test(subject) && /\brefer(ral|red)?\b/i.test(head) && !automated) {
    return result('REFERRAL_RESPONSE', 0.7, { ...ctx, reason: 'reply mentioning a referral' });
  }

  // 9. Recruiter outreach (from a person, not a platform).
  const outreach = matchText(OUTREACH, head);
  if (outreach && !(isLinkedIn && automated && !/messages-noreply|inmail/i.test(email))) {
    return result('RECRUITER_OUTREACH', automated ? 0.7 : 0.88, { ...ctx, reason: outreach });
  }

  // 10. Follow-up required.
  const follow = matchText(FOLLOW_UP, head);
  if (follow && JOB_WORDS.test(head)) return result('FOLLOW_UP_REQUIRED', 0.72, { ...ctx, reason: follow });
  if (/^re:/i.test(subject) && !automated && JOB_WORDS.test(head)) {
    return result('FOLLOW_UP_REQUIRED', 0.62, { ...ctx, reason: 'reply in a job-related thread' });
  }

  if (JOB_WORDS.test(head) || isPlatformDomain(domain)) return result('UNKNOWN', 0.35, ctx);
  return result('UNRELATED', 0.5, { ...ctx, company: undefined, role: undefined });
}
