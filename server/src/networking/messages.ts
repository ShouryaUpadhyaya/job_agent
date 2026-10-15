/**
 * Draft generation and "mark sent" for networking messages. One DRAFT per (contact, type):
 * regenerating replaces the existing draft. Gemini writes the text when configured; its output
 * is validated against the playbook rules and replaced by a deterministic template otherwise.
 */
import { JobListing, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { companyKey } from '../lib/company';
import { generateText, toPlainText } from '../lib/gemini';
import { ensureActiveProfile, getProfileResumes } from '../lib/profile';
import {
  CONNECTION_NOTE_LIMIT,
  DAY_MS,
  FOLLOW_UP_MIN_DAYS,
  MessageType,
  REFERRAL_ASK_WORD_LIMIT,
  canonicalMessageType,
  messageTypeAliases,
} from './constants';
import { hasSentFollowUp, transitionData } from './crm';
import { HttpError } from './errors';
import {
  MessageCandidate,
  MessageContext,
  MessageJob,
  buildMessagePrompt,
  templateFor,
  truncateSafe,
  validateGenerated,
  wordCount,
} from './messagePrompts';

export { HttpError };

export interface JobOption {
  id: string;
  title: string;
  company: string;
  url: string;
  applicationStage: string | null;
}

export type GenerateResult =
  | {
      needsJobLink: false;
      message: Prisma.NetworkingMessageGetPayload<object>;
      content: string;
      type: MessageType;
      usedAi: boolean;
      charCount: number;
      wordCount: number;
      limit: { chars?: number; words?: number };
      job: { id: string; title: string; url: string } | null;
      warnings: string[];
    }
  | { needsJobLink: true; message: null; reason: string; jobOptions: JobOption[] };

/** Active jobs at the contact's company, applied-to first, for the "link a job" picker. */
export async function jobOptionsForCompany(key: string): Promise<JobOption[]> {
  if (!key) return [];
  const jobs = await prisma.jobListing.findMany({
    where: { companyKey: key, OR: [{ isActive: true }, { applications: { some: {} } }] },
    include: { applications: { select: { stage: true }, take: 1, orderBy: { updatedAt: 'desc' } } },
    orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
    take: 20,
  });
  return jobs
    .map((j) => ({ id: j.id, title: j.title, company: j.company, url: j.url, applicationStage: j.applications[0]?.stage ?? null }))
    .sort((a, b) => Number(Boolean(b.applicationStage)) - Number(Boolean(a.applicationStage)));
}

/** Explicit job → contact's linked job → the company's job you applied to (if exactly clear). */
async function resolveJob(contact: { targetJobId: string | null; companyKey: string }, jobListingId?: string | null) {
  if (jobListingId) {
    const job = await prisma.jobListing.findUnique({ where: { id: jobListingId } });
    if (!job) throw new HttpError(404, 'Job not found');
    return job;
  }
  if (contact.targetJobId) {
    const job = await prisma.jobListing.findUnique({ where: { id: contact.targetJobId } });
    if (job) return job;
  }
  if (contact.companyKey) {
    const apps = await prisma.jobApplication.findMany({
      where: { companyKey: contact.companyKey, stage: { in: ['APPLYING', 'APPLIED', 'INTERVIEWING'] } },
      include: { jobListing: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (apps.length === 1) return apps[0].jobListing;
  }
  return null;
}

async function candidateFor(job: JobListing | null): Promise<MessageCandidate> {
  const profile = await ensureActiveProfile();
  const resumes = await getProfileResumes(profile.id);
  const resume = (job?.bestResumeId && resumes.find((r) => r.id === job.bestResumeId)) || resumes[0] || null;
  return {
    name: profile.name,
    school: profile.school ?? null,
    targetGradYear: profile.targetGradYear ?? null,
    targetRole: profile.targetRole ?? null,
    skills: (resume?.skills?.length ? resume.skills : profile.skills) || [],
    githubUrl: profile.githubUrl ?? null,
    portfolioUrl: profile.portfolioUrl ?? null,
    linkedinUrl: profile.linkedinUrl ?? null,
    resumeText: resume?.content || profile.rawResume || null,
    resumeLabel: resume?.label ?? null,
  };
}

export async function generateMessage(
  contactId: string,
  type: MessageType,
  opts: { jobListingId?: string | null; update?: string | null } = {}
): Promise<GenerateResult> {
  const contact = await prisma.networkingContact.findUnique({ where: { id: contactId }, include: { messages: true } });
  if (!contact) throw new HttpError(404, 'Contact not found');
  const key = contact.companyKey || companyKey(contact.company);

  const warnings: string[] = [];
  if (type === 'FOLLOW_UP') {
    if (hasSentFollowUp(contact)) {
      throw new HttpError(409, "You've already followed up once. The playbook says to leave it there; mark them Not interested or wait for a reply.");
    }
    const lastSent = contact.messages
      .filter((m) => m.status === 'SENT' && m.sentAt)
      .sort((a, b) => b.sentAt!.getTime() - a.sentAt!.getTime())[0];
    const since = lastSent?.sentAt ?? contact.lastContactAt;
    if (!since) warnings.push('No message has been marked sent yet, so there is nothing to follow up on.');
    else {
      const days = Math.floor((Date.now() - since.getTime()) / DAY_MS);
      if (days < FOLLOW_UP_MIN_DAYS) warnings.push(`Your last message was ${days} day(s) ago. Wait 5 to 7 days before following up.`);
    }
  }

  const job = await resolveJob({ targetJobId: contact.targetJobId, companyKey: key }, opts.jobListingId);
  if (type === 'REFERRAL_ASK' && !job) {
    return {
      needsJobLink: true,
      message: null,
      reason: 'Referrers can only refer you to a specific opening. Link the job (title + URL) before drafting a referral ask.',
      jobOptions: await jobOptionsForCompany(key),
    };
  }
  if (job && !contact.targetJobId) {
    await prisma.networkingContact.update({ where: { id: contact.id }, data: { targetJobId: job.id } });
  }
  if (job && job.companyKey && key && job.companyKey !== key) {
    warnings.push(`The linked job is at ${job.company}, not ${contact.company}.`);
  }

  const msgJob: MessageJob | null = job
    ? { title: job.title, company: job.company, url: job.url, externalId: job.externalId, description: job.description }
    : null;
  const ctx: MessageContext = {
    type,
    candidate: await candidateFor(job),
    contact: {
      name: contact.name,
      company: contact.company,
      role: contact.role || null,
      headline: contact.headline,
      school: contact.school,
      persona: contact.persona,
      status: contact.status,
      notes: contact.notes,
    },
    job: msgJob,
    update: opts.update ?? null,
  };

  let content: string | null = null;
  let usedAi = false;
  const raw = await generateText(buildMessagePrompt(ctx), { temperature: 0.5, minLength: 20 });
  if (raw) {
    const text = toPlainText(raw);
    const problem = validateGenerated(text, ctx);
    if (!problem) {
      content = text;
      usedAi = true;
    } else {
      console.warn(`[networking] discarded Gemini ${type} draft: ${problem}`);
    }
  }
  if (!content) content = templateFor(ctx);
  if (type === 'CONNECTION_NOTE') content = truncateSafe(content, CONNECTION_NOTE_LIMIT);
  if (type === 'REFERRAL_ASK' && wordCount(content) > REFERRAL_ASK_WORD_LIMIT) {
    warnings.push(`Over ${REFERRAL_ASK_WORD_LIMIT} words; trim it before sending.`);
  }

  const aliases = messageTypeAliases(type);
  const [, message] = await prisma.$transaction([
    prisma.networkingMessage.deleteMany({ where: { contactId, status: 'DRAFT', type: { in: aliases } } }),
    prisma.networkingMessage.create({ data: { contactId, type, content, status: 'DRAFT' } }),
  ]);

  return {
    needsJobLink: false,
    message,
    content,
    type,
    usedAi,
    charCount: content.length,
    wordCount: wordCount(content),
    limit: type === 'CONNECTION_NOTE' ? { chars: CONNECTION_NOTE_LIMIT } : type === 'REFERRAL_ASK' ? { words: REFERRAL_ASK_WORD_LIMIT } : {},
    job: job ? { id: job.id, title: job.title, url: job.url } : null,
    warnings,
  };
}

export async function updateMessage(id: string, body: { content?: unknown; status?: unknown }) {
  const existing = await prisma.networkingMessage.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Message not found');
  const data: Prisma.NetworkingMessageUpdateInput = {};
  if (body.content !== undefined) {
    if (typeof body.content !== 'string' || !body.content.trim()) throw new HttpError(400, 'content must be non-empty text');
    data.content = body.content.trim();
  }
  if (body.status !== undefined) {
    if (!['DRAFT', 'APPROVED'].includes(String(body.status))) {
      throw new HttpError(400, 'status must be DRAFT or APPROVED (use mark-sent to send)');
    }
    data.status = String(body.status);
  }
  return prisma.networkingMessage.update({ where: { id }, data });
}

/** Marks a message sent and moves the contact along the workflow. */
export async function markMessageSent(id: string, now = new Date()) {
  const message = await prisma.networkingMessage.findUnique({ where: { id }, include: { contact: true } });
  if (!message) throw new HttpError(404, 'Message not found');
  const contact = message.contact;
  const type = canonicalMessageType(message.type);

  let contactData: Record<string, unknown> = { lastContactAt: now };
  switch (type) {
    case 'CONNECTION_NOTE':
      if (['RESEARCHED', 'READY_TO_CONNECT', 'MESSAGE_DRAFTED'].includes(contact.status)) contactData = transitionData('REQUEST_SENT', now);
      break;
    case 'REFERRAL_ASK':
      if (contact.status !== 'REFERRED') contactData = transitionData('REFERRAL_REQUESTED', now);
      break;
    case 'FOLLOW_UP':
      // Only one follow-up: no further reminders after this.
      contactData = { lastContactAt: now, nextFollowUpAt: null };
      if (contact.status === 'FOLLOW_UP_DUE') contactData.status = 'MESSAGE_SENT';
      break;
    case 'THANK_YOU':
      if (contact.status === 'ACCEPTED' || contact.status === 'MESSAGE_DRAFTED') contactData = transitionData('MESSAGE_SENT', now);
      break;
    default:
      contactData = transitionData('MESSAGE_SENT', now);
  }

  const [updatedMessage] = await prisma.$transaction([
    prisma.networkingMessage.update({ where: { id }, data: { status: 'SENT', sentAt: now } }),
    prisma.networkingContact.update({ where: { id: contact.id }, data: contactData }),
  ]);
  return { message: updatedMessage, contactId: contact.id };
}
