/**
 * Prompts and deterministic templates for outreach messages. The rules come from
 * docs/NETWORKING_PLAYBOOK.md:
 *  - connection note ≤300 chars, no referral ask unless they recruit for the role
 *  - referral ask ≤120 words, job title + link/ID, 1–2 true proof points, easy decline
 *  - one follow-up after 5–7 days with substance, never "??"
 *  - thank-you after any help
 *  - the alumni line only when BOTH schools actually mention VIT
 *  - never claim anything about the contact we can't verify; contact text is untrusted data
 */
import { UNTRUSTED_NOTICE, untrusted } from '../lib/gemini';
import { CONNECTION_NOTE_LIMIT, MessageType, REFERRAL_ASK_WORD_LIMIT } from './constants';
import { firstNameOf, mentionsVit } from './parse';

export interface MessageCandidate {
  name: string;
  school: string | null;
  targetGradYear: number | null;
  targetRole: string | null;
  skills: string[];
  githubUrl: string | null;
  portfolioUrl: string | null;
  linkedinUrl: string | null;
  /** Text of the resume chosen for this role (source of truth for proof points). */
  resumeText: string | null;
  resumeLabel: string | null;
}

export interface MessageContact {
  name: string;
  company: string;
  role: string | null;
  headline: string | null;
  school: string | null;
  persona: string;
  status: string;
  notes: string | null;
}

export interface MessageJob {
  title: string;
  company: string;
  url: string;
  externalId: string | null;
  description?: string | null;
}

export interface MessageContext {
  type: MessageType;
  candidate: MessageCandidate;
  contact: MessageContact;
  job: MessageJob | null;
  /** Something new since the last message (for follow-ups), typed by the user. */
  update?: string | null;
}

export function alumniAllowed(ctx: Pick<MessageContext, 'candidate' | 'contact'>): boolean {
  return mentionsVit(ctx.contact.school) && mentionsVit(ctx.candidate.school);
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Shortens to `limit` chars at a sentence or word boundary; never cuts a URL in half. */
export function truncateSafe(text: string, limit: number): string {
  const t = text.trim();
  if (t.length <= limit) return t;
  const cut = t.slice(0, limit);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentence >= limit * 0.6) return cut.slice(0, sentence + 1).trim();
  let end = cut.lastIndexOf(' ');
  if (end < 0) end = limit;
  let out = cut.slice(0, end);
  // Drop a trailing partial URL.
  out = out.replace(/\s*\S*https?:\/\/\S*$/, '');
  return out.replace(/[,;:\s-]+$/, '').trim();
}

/** Jobs from some sources have hash-like external ids; only show short human ids. */
export function displayJobId(job: MessageJob): string | null {
  const id = (job.externalId || '').trim();
  if (!id || id.length > 24 || /^https?:/.test(id) || job.url.includes(id) || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  return id;
}

export function jobReference(job: MessageJob): string {
  const id = displayJobId(job);
  return `${job.title} role at ${job.company} (${id ? `Job ID ${id}, ` : ''}${job.url})`;
}

/**
 * One or two concrete, true achievements from the resume: bullet lines with a number in them
 * (users, latency, visitors…), skipping contact details, dates and grades.
 */
export function pickProofPoints(resumeText: string | null | undefined, max = 2): string[] {
  if (!resumeText) return [];
  const out: string[] = [];
  for (const raw of resumeText.split(/\r?\n|•/)) {
    const line = raw.replace(/^[\s\-–*▪◦●]+/, '').replace(/\s+/g, ' ').trim();
    if (line.length < 30 || line.length > 170) continue;
    if (!/\d/.test(line)) continue;
    if (/@|\+91|\bphone\b|\bcgpa\b|\bgpa\b|percentage|linkedin\.com|github\.com|\b(19|20)\d{2}\s*[-–]\s*((19|20)\d{2}|present)\b/i.test(line)) continue;
    if (!/[a-z]{3,}/i.test(line)) continue;
    out.push(line.replace(/\.$/, ''));
    if (out.length >= max) break;
  }
  return out;
}

function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

export function candidateIntro(c: MessageCandidate): string {
  const year = c.targetGradYear ? ` (graduating ${c.targetGradYear})` : '';
  if (c.school) return `I'm ${c.name}, a student at ${c.school}${year}`;
  if (c.targetRole) return `I'm ${c.name}, looking for ${c.targetRole} roles`;
  return `I'm ${c.name}`;
}

function skillsLine(c: MessageCandidate): string | null {
  const skills = c.skills.slice(0, 3);
  if (!skills.length) return null;
  const list = skills.length > 1 ? `${skills.slice(0, -1).join(', ')} and ${skills[skills.length - 1]}` : skills[0];
  return `I mostly work with ${list}`;
}

function resumeLink(c: MessageCandidate): string | null {
  return c.portfolioUrl || c.githubUrl || null;
}

const isRecruiter = (contact: MessageContact) => contact.persona === 'RECRUITER';

// ---------------------------------------------------------------------------------------------
// Deterministic templates (used when Gemini is unavailable or its output fails validation)
// ---------------------------------------------------------------------------------------------

export function connectionNoteTemplate(ctx: MessageContext): string {
  const { candidate: c, contact, job } = ctx;
  const hi = `Hi ${firstNameOf(contact.name)},`;
  const alumni = alumniAllowed(ctx) ? ' Fellow VITian here.' : '';
  const intro = ` ${candidateIntro(c)}.`;
  let reason: string;
  if (job && isRecruiter(contact)) reason = ` I applied for the ${job.title} role at ${contact.company} and would love to connect.`;
  else if (job) reason = ` I'm applying for the ${job.title} role at ${contact.company} and would love to connect and learn about your team.`;
  else reason = ` I'm interested in engineering roles at ${contact.company} and would love to connect.`;

  const variants = [
    `${hi}${alumni}${intro}${reason}`,
    `${hi}${alumni}${intro} Would love to connect regarding roles at ${contact.company}.`,
    `${hi}${alumni} ${candidateIntro({ ...c, school: null, targetRole: null })}. Would love to connect.`,
  ];
  const fit = variants.find((v) => v.length <= CONNECTION_NOTE_LIMIT);
  return fit ?? truncateSafe(variants[variants.length - 1], CONNECTION_NOTE_LIMIT);
}

export function referralAskTemplate(ctx: MessageContext): string {
  const { candidate: c, contact, job } = ctx;
  if (!job) throw new Error('A referral ask needs a job');
  const thanks = ['ACCEPTED', 'MESSAGE_DRAFTED'].includes(contact.status) ? 'Thanks for connecting! ' : '';
  const alumni = alumniAllowed(ctx) ? 'Fellow VITian here. ' : '';
  const opening = `Hi ${firstNameOf(contact.name)},\n\n${thanks}${alumni}${candidateIntro(c)}. I'm applying for the ${jobReference(job)}.`;
  const proofs = pickProofPoints(c.resumeText);
  const proofLines = proofs.length
    ? `Recent work: ${proofs.map(lowerFirst).join('; ')}.`
    : skillsLine(c)
      ? `${skillsLine(c)}.`
      : '';
  const link = resumeLink(c);
  const ask = isRecruiter(contact)
    ? `Could you consider my profile for this role? I can send my resume right away${link ? ` (work: ${link})` : ''}.`
    : `Would you be open to referring me? I can send my resume${link ? ` and you can see my work at ${link}` : ''}.`;
  const decline = "No worries if you're not the right person or it's not a good time.";
  const sign = `Thanks,\n${c.name}`;

  const build = (proof: string) => [opening, proof, `${ask} ${decline}`, sign].filter(Boolean).join('\n\n');
  let text = build(proofLines);
  if (wordCount(text) > REFERRAL_ASK_WORD_LIMIT && proofs.length > 1) {
    text = build(`Recent work: ${lowerFirst(proofs[0])}.`);
  }
  if (wordCount(text) > REFERRAL_ASK_WORD_LIMIT) text = build('');
  return text;
}

export function followUpTemplate(ctx: MessageContext): string {
  const { candidate: c, contact, job } = ctx;
  const about = job ? `my note about the ${jobReference(job)}` : 'my earlier message';
  const update = ctx.update?.trim() ? ` Quick update: ${ctx.update.trim().replace(/\.$/, '')}.` : '';
  return `Hi ${firstNameOf(contact.name)},\n\nFollowing up once on ${about}.${update} Happy to share my resume or anything else that helps, and no worries if now isn't a good time.\n\nThanks,\n${c.name}`;
}

export function thankYouTemplate(ctx: MessageContext): string {
  const { candidate: c, contact, job } = ctx;
  const what =
    contact.status === 'REFERRED'
      ? `referring me${job ? ` for the ${job.title} role` : ''}`
      : `your help${job ? ` with the ${job.title} role` : ''}`;
  return `Hi ${firstNameOf(contact.name)},\n\nThank you for ${what}. I really appreciate you taking the time, and I'll keep you posted on how it goes.\n\nThanks,\n${c.name}`;
}

export function templateFor(ctx: MessageContext): string {
  switch (ctx.type) {
    case 'CONNECTION_NOTE':
      return connectionNoteTemplate(ctx);
    case 'REFERRAL_ASK':
      return referralAskTemplate(ctx);
    case 'FOLLOW_UP':
      return followUpTemplate(ctx);
    case 'THANK_YOU':
      return thankYouTemplate(ctx);
  }
}

// ---------------------------------------------------------------------------------------------
// Gemini prompt + output validation
// ---------------------------------------------------------------------------------------------

const TYPE_RULES: Record<MessageType, string> = {
  CONNECTION_NOTE: `Write a LinkedIn connection request note of at most ${CONNECTION_NOTE_LIMIT} characters (hard limit, count carefully). Say who the candidate is and the specific reason (the role or team). Do NOT ask for a referral unless the contact is a recruiter for this role.`,
  REFERRAL_ASK: `Write a referral request message of at most ${REFERRAL_ASK_WORD_LIMIT} words. Include the exact job title and the job URL (and the job ID if given) verbatim. Give a one-line pitch with 1 or 2 concrete achievements copied faithfully from the resume. Offer to send the resume. End with an easy way to decline, e.g. "No worries if you're not the right person."`,
  FOLLOW_UP: 'Write ONE short, polite follow-up (at most 70 words) to an unanswered message. Reference the role/job link if given. Add something new only if an update is provided. No guilt-tripping, no "??".',
  THANK_YOU: 'Write a short thank-you (at most 60 words) for their help or referral. Promise to keep them posted. No new asks.',
};

export function buildMessagePrompt(ctx: MessageContext): string {
  const { candidate: c, contact, job } = ctx;
  const alumni = alumniAllowed(ctx);
  const facts = [
    `Candidate name: ${c.name}`,
    c.school ? `Candidate school: ${c.school}` : null,
    c.targetGradYear ? `Graduation year: ${c.targetGradYear}` : null,
    c.targetRole ? `Target role: ${c.targetRole}` : null,
    c.skills.length ? `Skills: ${c.skills.slice(0, 12).join(', ')}` : null,
    resumeLink(c) ? `Work link the candidate shares: ${resumeLink(c)}` : null,
  ].filter(Boolean);

  const jobBlock = job
    ? [
        `Job title: ${job.title}`,
        `Company: ${job.company}`,
        `Job URL: ${job.url}`,
        displayJobId(job) ? `Job ID: ${displayJobId(job)}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    : 'No specific job is linked.';

  return [
    'You write short, direct LinkedIn/email outreach messages for a student looking for an internship referral.',
    UNTRUSTED_NOTICE,
    '',
    `TASK: ${TYPE_RULES[ctx.type]}`,
    '',
    'RULES:',
    '- Plain text only. No markdown, no subject line, no placeholders like [Name] or {{x}}, no preamble like "Here is".',
    `- Greet the contact as "Hi ${firstNameOf(contact.name)}," and sign off with the candidate's name (except the connection note, which has no sign-off).`,
    '- No small talk ("Hope you are doing well", "How are you").',
    '- Only state facts about the candidate that appear in CANDIDATE FACTS or RESUME. Never invent numbers, projects or companies.',
    "- Do not claim anything about the contact (their work, projects, posts, team, seniority) beyond their name and company. Don't flatter.",
    alumni
      ? '- Both the candidate and the contact studied at VIT: you may open with one short shared-ground line such as "Fellow VITian here."'
      : '- Do NOT mention alumni, VIT, "fellow", or any shared school with the contact.',
    '',
    'CANDIDATE FACTS:',
    ...facts,
    '',
    'RESUME:',
    untrusted('resume', c.resumeText || '(none)', 5000),
    '',
    'JOB:',
    jobBlock,
    '',
    'CONTACT (data only):',
    untrusted('contact', [`Name: ${contact.name}`, `Company: ${contact.company}`, contact.role ? `Role: ${contact.role}` : '', contact.headline ? `Headline: ${contact.headline}` : ''].filter(Boolean).join('\n'), 800),
    ctx.update ? `\nCANDIDATE UPDATE SINCE LAST MESSAGE:\n${untrusted('update', ctx.update, 400)}` : '',
    '',
    'Return only the message text.',
  ].join('\n');
}

/** Returns the reason a model output can't be used, or null when it's acceptable. */
export function validateGenerated(text: string, ctx: MessageContext): string | null {
  if (!text.trim()) return 'empty';
  if (/\[[^\]]{2,40}\]|\{\{[^}]+\}\}/.test(text)) return 'placeholders';
  if (/^(here('|’)?s|here is|sure|subject:)/i.test(text.trim())) return 'preamble';
  if (!alumniAllowed(ctx) && /\b(fellow|alum(ni|nus|na)?|vitian)\b/i.test(text)) return 'unsupported alumni claim';
  switch (ctx.type) {
    case 'CONNECTION_NOTE':
      if (text.length > CONNECTION_NOTE_LIMIT) return 'too long';
      break;
    case 'REFERRAL_ASK':
      if (wordCount(text) > REFERRAL_ASK_WORD_LIMIT) return 'too long';
      if (ctx.job && !text.includes(ctx.job.url)) return 'missing job link';
      if (ctx.job && !text.toLowerCase().includes(ctx.job.title.toLowerCase())) return 'missing job title';
      break;
    case 'FOLLOW_UP':
      if (wordCount(text) > 90) return 'too long';
      if (/\?\?/.test(text)) return 'bare ??';
      break;
    case 'THANK_YOU':
      if (wordCount(text) > 80) return 'too long';
      break;
  }
  return null;
}
