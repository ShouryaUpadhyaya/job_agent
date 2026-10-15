/**
 * Side effects of a newly stored email: pipeline stage updates, application creation from
 * confirmations, LinkedIn-accept and recruiter-contact handling, and job-alert ingestion.
 * Called exactly once per message (the EmailEvent row is created first, so re-syncs skip it).
 *
 * Choices:
 *  - Stage changes go through canTransition(..., 'email'): forward-only, never out of
 *    REJECTED/OFFERED/ARCHIVED, and only for rule-based results with confidence >= 0.8.
 *  - ASSESSMENT does not change the stage (an assessment is not an interview); it adds a dated
 *    note to the application, and moves BOOKMARKED/APPLYING to APPLIED since you clearly applied.
 *  - Contacts are only created from a person's own mailbox, never from no-reply/ATS senders.
 */
import { prisma } from '../db';
import { companyKey } from '../lib/company';
import { canTransition, statusForStage, Stage } from '../lib/stages';
import { ensureActiveProfile } from '../lib/profile';
import { recordApplicationCreated, recordStageChange } from '../applications/audit';
import { createContact, findDuplicate } from '../networking/contacts';
import { transitionData } from '../networking/crm';
import { generateMessage } from '../networking/messages';
import { ContactStatus } from '../networking/constants';
import { ingestJobAlertEmail } from '../discovery/jobAlerts';
import { ClassificationResult, domainLabel, isPersonalDomain } from './classifier';
import { jobPostingLink, senderDomain } from './mime';

export const STAGE_MIN_CONFIDENCE = 0.8;

export interface EffectEmail {
  messageId: string;
  sender: string;
  senderName?: string | null;
  subject: string;
  body: string;
  html?: string | null;
  receivedAt: Date;
}

export interface StageChange {
  applicationId: string;
  from: string;
  to: string;
}

export interface EffectsOutcome {
  jobApplicationId: string | null;
  networkingContactId: string | null;
  notes: string[];
  stageChange?: StageChange;
  createdApplication?: boolean;
  createdContact?: boolean;
  alert?: { parsed: number; created: number; updated: number };
}

/** Marker appended to EmailEvent.explanation so the summary can list stage changes. */
export function stageMarker(change: StageChange): string {
  return `[stage ${change.from}→${change.to}]`;
}

export function parseStageMarker(explanation: string | null | undefined): { from: string; to: string } | null {
  const m = (explanation || '').match(/\[stage (\w+)→(\w+)\]/);
  return m ? { from: m[1], to: m[2] } : null;
}

const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'for', 'at', 'in', 'to', 'role', 'position', '-', '2025', '2026', '2027']);
function tokens(s: string | null | undefined): Set<string> {
  return new Set(
    (s || '')
      .toLowerCase()
      .split(/[^a-z0-9+#]+/)
      .filter((t) => t && !STOP.has(t))
  );
}

export function roleSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

type AppWithListing = Awaited<ReturnType<typeof findApplications>>[number];

async function findApplications(key: string) {
  return prisma.jobApplication.findMany({
    where: { OR: [{ companyKey: key }, { jobListing: { companyKey: key } }] },
    include: { jobListing: { select: { id: true, title: true, company: true } } },
    orderBy: { updatedAt: 'desc' },
  });
}

/** Application at this company, best role match first; archived ones only as a last resort. */
export async function matchApplication(company: string | null | undefined, role?: string | null): Promise<AppWithListing | null> {
  const key = companyKey(company);
  if (!key) return null;
  const apps = await findApplications(key);
  if (!apps.length) return null;
  const ranked = apps
    .map((a, i) => ({ a, score: (a.stage === 'ARCHIVED' ? -1 : 0) + (role ? roleSimilarity(role, a.jobListing.title) : 0), i }))
    .sort((x, y) => y.score - x.score || x.i - y.i);
  return ranked[0].a;
}

const TARGET_STAGE: Partial<Record<ClassificationResult['classification'], Stage>> = {
  APPLICATION_CONFIRMATION: 'APPLIED',
  INTERVIEW_INVITATION: 'INTERVIEWING',
  OFFER: 'OFFERED',
  REJECTION: 'REJECTED',
};

async function applyStage(app: AppWithListing, to: Stage, email: EffectEmail): Promise<StageChange | undefined> {
  if (!canTransition(app.stage, to, 'email')) return undefined;
  await prisma.jobApplication.update({
    where: { id: app.id },
    data: {
      stage: to,
      status: statusForStage(to),
      ...(to === 'APPLIED' && !app.submittedAt ? { submittedAt: email.receivedAt } : {}),
    },
  });
  await recordStageChange(app.id, app.stage, to, 'email');
  return { applicationId: app.id, from: app.stage, to };
}

async function createApplicationFromEmail(cls: ClassificationResult, email: EffectEmail) {
  const company = cls.company!;
  const key = companyKey(company);
  const url = jobPostingLink(`${email.html || ''}\n${email.body}`) || '';
  const profile = await ensureActiveProfile();
  const listing = await prisma.jobListing.upsert({
    where: { externalId_source: { externalId: `email-${email.messageId}`, source: 'email' } },
    update: {},
    create: {
      externalId: `email-${email.messageId}`,
      source: 'email',
      title: cls.role || 'Role not stated in email',
      company,
      companyKey: key,
      url,
      description: '',
      tags: ['From email'],
      publishedAt: null,
    },
  });
  const created = await prisma.jobApplication.create({
    data: {
      jobListingId: listing.id,
      candidateProfileId: profile.id,
      stage: 'APPLIED',
      status: statusForStage('APPLIED'),
      source: 'email',
      companyKey: key,
      submittedAt: email.receivedAt,
      appliedUrl: url || null,
      lastEmailAt: email.receivedAt,
      notes: `Created from application confirmation email "${email.subject.slice(0, 140)}".`,
    },
  });
  await recordApplicationCreated({ applicationId: created.id, jobListingId: listing.id, stage: created.stage, source: 'email' });
  return created;
}

const PERSON_NAME = /^[\p{L}][\p{L}.'’-]*(?:\s+[\p{L}][\p{L}.'’-]*){1,3}$/u;
const NOT_A_PERSON = /\b(team|recruiting|recruitment|careers|talent|hiring|hr|jobs|support|notifications?|no-?reply|admin|info|hello|updates?|linkedin|naukri|via)\b/i;

export function looksLikePersonName(name: string | null | undefined): boolean {
  const n = (name || '').trim();
  return Boolean(n) && n.length <= 60 && PERSON_NAME.test(n) && !NOT_A_PERSON.test(n);
}

const CREATE_CONTACT_FOR = new Set(['RECRUITER_OUTREACH', 'REFERRAL_RESPONSE', 'FOLLOW_UP_REQUIRED', 'INTERVIEW_INVITATION', 'ASSESSMENT', 'OFFER']);
const AWAITING_REPLY: ContactStatus[] = ['REQUEST_SENT', 'ACCEPTED', 'MESSAGE_DRAFTED', 'MESSAGE_SENT', 'REFERRAL_REQUESTED', 'FOLLOW_UP_DUE'];

/** Links (and for person senders, creates) the NetworkingContact behind a human email. */
async function senderContact(cls: ClassificationResult, email: EffectEmail, notes: string[]): Promise<{ id: string; created: boolean } | null> {
  if (cls.automatedSender) return null;
  const address = email.sender.toLowerCase();
  if (!address.includes('@')) return null;

  let contact = await prisma.networkingContact.findFirst({ where: { email: { equals: address, mode: 'insensitive' } }, orderBy: { updatedAt: 'desc' } });
  let created = false;

  if (!contact && CREATE_CONTACT_FOR.has(cls.classification) && looksLikePersonName(email.senderName)) {
    const domain = senderDomain(address);
    const company = cls.company || (isPersonalDomain(domain) ? undefined : domainLabel(domain).replace(/^./, (c) => c.toUpperCase()));
    if (!company) {
      notes.push('Sender not saved to Networking: company unknown.');
      return null;
    }
    const dup = await findDuplicate({ name: email.senderName!, companyKey: companyKey(company) });
    if (dup) {
      contact = dup.contact;
      if (!contact.email) {
        contact = await prisma.networkingContact.update({ where: { id: contact.id }, data: { email: address, emailSource: 'gmail' } });
      }
    } else {
      const recruiterish = cls.classification === 'RECRUITER_OUTREACH' || /recruit|talent|\bhr\b|people/i.test(`${email.senderName} ${address} ${email.body.slice(-800)}`);
      const dto = await createContact({
        name: email.senderName,
        company,
        role: recruiterish ? 'Recruiter' : '',
        persona: recruiterish ? 'RECRUITER' : 'OTHER',
        source: 'GMAIL',
        email: address,
        emailSource: 'gmail',
        notes: `Emailed you on ${email.receivedAt.toISOString().slice(0, 10)}: "${email.subject.slice(0, 140)}"`,
      });
      contact = await prisma.networkingContact.findUnique({ where: { id: dto.id } });
      created = true;
      notes.push(`Saved ${email.senderName} (${company}) to Networking.`);
    }
  }
  if (!contact) return null;

  // A reply from someone you were waiting on.
  if (!created) {
    let next: ContactStatus | null = null;
    if (cls.classification === 'REFERRAL_RESPONSE' && /\b(referred you|submitted (a|your|the) referral|i('ve| have) (just )?referred|referral (has been )?(submitted|done|sent))\b/i.test(`${email.subject}\n${email.body}`)) {
      next = contact.status === 'REFERRED' ? null : 'REFERRED';
    } else if ((AWAITING_REPLY as string[]).includes(contact.status)) {
      next = 'REPLIED';
    }
    if (next) {
      await prisma.networkingContact.update({ where: { id: contact.id }, data: transitionData(next, email.receivedAt) });
      notes.push(`${contact.name}: ${contact.status} → ${next}.`);
    }
  }
  return { id: contact.id, created };
}

async function linkedInAccepted(cls: ClassificationResult, email: EffectEmail, notes: string[]): Promise<string | null> {
  const person = cls.extractedPerson?.replace(/\s+/g, ' ').trim();
  if (!person) return null;
  let matches = await prisma.networkingContact.findMany({
    where: { name: { equals: person, mode: 'insensitive' } },
    orderBy: { updatedAt: 'desc' },
  });
  const key = companyKey(cls.company);
  if (matches.length > 1 && key) {
    const sameCompany = matches.filter((c) => (c.companyKey || companyKey(c.company)) === key);
    if (sameCompany.length) matches = sameCompany;
  }
  if (matches.length > 1) {
    const requested = matches.filter((c) => c.status === 'REQUEST_SENT');
    if (requested.length) matches = requested;
  }
  const contact = matches[0];
  if (!contact) {
    notes.push(`No Networking contact named ${person}; add them to track the connection.`);
    return null;
  }
  if (['RESEARCHED', 'READY_TO_CONNECT', 'REQUEST_SENT'].includes(contact.status)) {
    await prisma.networkingContact.update({ where: { id: contact.id }, data: transitionData('ACCEPTED', email.receivedAt) });
    notes.push(`${contact.name} marked ACCEPTED.`);
    const draft = await generateMessage(contact.id, 'REFERRAL_ASK');
    if (draft.needsJobLink) notes.push('Link a job to this contact to draft the referral ask.');
    else notes.push('Referral ask drafted in Networking.');
  }
  return contact.id;
}

export async function applyEffects(cls: ClassificationResult, email: EffectEmail, opts: { aiRefined?: boolean } = {}): Promise<EffectsOutcome> {
  const out: EffectsOutcome = { jobApplicationId: null, networkingContactId: null, notes: [] };
  const trusted = !opts.aiRefined;

  // Pipeline.
  const stageTarget = TARGET_STAGE[cls.classification];
  const pipelineRelevant = Boolean(stageTarget) || cls.classification === 'ASSESSMENT';
  if (pipelineRelevant && cls.company) {
    let app = await matchApplication(cls.company, cls.role);
    if (!app && cls.classification === 'APPLICATION_CONFIRMATION' && trusted && cls.confidence >= 0.7) {
      const created = await createApplicationFromEmail(cls, email);
      out.jobApplicationId = created.id;
      out.createdApplication = true;
      out.notes.push(`New application tracked: ${cls.company}${cls.role ? ` (${cls.role})` : ''}.`);
    } else if (app) {
      out.jobApplicationId = app.id;
      const allowStage = trusted && cls.confidence >= (cls.classification === 'APPLICATION_CONFIRMATION' ? 0.7 : STAGE_MIN_CONFIDENCE);
      if (stageTarget && allowStage) {
        out.stageChange = await applyStage(app, stageTarget, email);
        if (!out.stageChange && app.stage !== stageTarget) out.notes.push(`Stage left at ${app.stage} (email suggests ${stageTarget}).`);
      }
      if (cls.classification === 'ASSESSMENT') {
        if (trusted) out.stageChange = await applyStage(app, 'APPLIED', email);
        const line = `${email.receivedAt.toISOString().slice(0, 10)} Assessment invite by email: "${email.subject.slice(0, 120)}"${cls.deadline ? ` (deadline: ${cls.deadline})` : ''}`;
        app = (await prisma.jobApplication.findUnique({ where: { id: app.id }, include: { jobListing: { select: { id: true, title: true, company: true } } } }))!;
        await prisma.jobApplication.update({ where: { id: app.id }, data: { notes: app.notes ? `${app.notes}\n${line}` : line } });
      }
    }
  }
  if (out.jobApplicationId) {
    await prisma.jobApplication.updateMany({
      where: { id: out.jobApplicationId, OR: [{ lastEmailAt: null }, { lastEmailAt: { lt: email.receivedAt } }] },
      data: { lastEmailAt: email.receivedAt },
    });
  }

  // Networking.
  if (cls.classification === 'LINKEDIN_CONNECTION_ACCEPTED') {
    out.networkingContactId = await linkedInAccepted(cls, email, out.notes);
  } else if (cls.classification !== 'JOB_ALERT') {
    const contact = await senderContact(cls, email, out.notes);
    if (contact) {
      out.networkingContactId = contact.id;
      out.createdContact = contact.created;
    }
  }

  // Discovery.
  if (cls.classification === 'JOB_ALERT') {
    const res = await ingestJobAlertEmail({ from: email.sender, subject: email.subject, html: email.html || null, text: email.body, receivedAt: email.receivedAt });
    out.alert = { parsed: res.parsed, created: res.created, updated: res.updated };
    out.notes.push(res.parsed ? `Job alert: ${res.created} new and ${res.updated} updated listings.` : 'Job alert: no listings recognised.');
  }

  if (out.stageChange) out.notes.push(stageMarker(out.stageChange));
  return out;
}
