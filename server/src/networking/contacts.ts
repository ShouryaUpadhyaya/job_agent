/**
 * Contact CRUD, filtering, dedupe/merge and the read model (priority, derived status, next
 * actions) shared by the CRM page and the Pipeline's people strip.
 */
import { NetworkingContact, NetworkingMessage, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { companyKey } from '../lib/company';
import {
  CONTACT_SOURCES,
  CONTACT_STATUSES,
  EMAIL_SOURCES,
  PERSONAS,
  isOneOf,
} from './constants';
import { NextAction, effectiveStatus, isFollowUpDue, nextActions, transitionData } from './crm';
import { HttpError } from './errors';
import {
  inferPersona,
  inferSchool,
  mentionsVit,
  normalizeEmail,
  normalizeGithubUrl,
  normalizeLinkedinUrl,
  normalizeName,
  normalizeXUrl,
} from './parse';
import { Priority, PriorityCompanyInfo, computePriority, isNoReply, loadCompanyInfo } from './priority';

const CONTACT_INCLUDE = {
  targetJob: { select: { id: true, title: true, company: true, url: true, externalId: true, isActive: true } },
  messages: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.NetworkingContactInclude;

type ContactRow = Prisma.NetworkingContactGetPayload<{ include: typeof CONTACT_INCLUDE }>;

export interface ContactDto extends Omit<ContactRow, 'messages'> {
  messages: NetworkingMessage[];
  priority: Priority;
  effectiveStatus: string;
  followUpDue: boolean;
  noReply: boolean;
  nextActions: NextAction[];
  applicationStage: string | null;
}

export function toDto(c: ContactRow, info: PriorityCompanyInfo | undefined, now = new Date()): ContactDto {
  const linkedinUrl = c.linkedinUrl || (c.profileUrl && /linkedin\.com\/in\//i.test(c.profileUrl) ? c.profileUrl : null);
  const withLink = { ...c, linkedinUrl };
  return {
    ...withLink,
    priority: computePriority(withLink, info, now),
    effectiveStatus: effectiveStatus(c, now),
    followUpDue: isFollowUpDue(c, now),
    noReply: isNoReply(c, now),
    nextActions: nextActions(c, now),
    applicationStage: info?.applicationStage ?? null,
  };
}

export async function toDtos(rows: ContactRow[], now = new Date()): Promise<ContactDto[]> {
  const info = await loadCompanyInfo(rows.map((r) => r.companyKey || companyKey(r.company)), now);
  return rows.map((r) => toDto(r, info.get(r.companyKey || companyKey(r.company)), now));
}

export async function getContactDto(id: string): Promise<ContactDto | null> {
  const row = await prisma.networkingContact.findUnique({ where: { id }, include: CONTACT_INCLUDE });
  if (!row) return null;
  return (await toDtos([row]))[0];
}

// ---------------------------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------------------------

export const SORTS = ['priority', 'recent', 'company', 'followUp'] as const;
export type ContactSort = (typeof SORTS)[number];

export interface ListQuery {
  companyKey?: string;
  company?: string;
  persona?: string;
  alumni?: string;
  status?: string;
  source?: string;
  followUpDue?: string;
  q?: string;
  sort?: string;
  limit?: string;
}

const csv = (v: unknown): string[] =>
  typeof v === 'string'
    ? v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

export async function listContacts(query: ListQuery, now = new Date()): Promise<ContactDto[]> {
  const and: Prisma.NetworkingContactWhereInput[] = [];

  const keys = csv(query.companyKey).map((k) => companyKey(k) || k);
  if (keys.length) and.push({ companyKey: { in: keys } });
  if (query.company?.trim()) {
    const name = query.company.trim();
    const key = companyKey(name);
    and.push({ OR: [...(key ? [{ companyKey: key }] : []), { company: { contains: name, mode: 'insensitive' } }] });
  }
  const personas = csv(query.persona).filter((p) => isOneOf(PERSONAS, p));
  if (personas.length) and.push({ persona: { in: personas } });
  if (query.alumni === 'true') and.push({ OR: [{ vitAlumni: true }, { school: { contains: 'VIT', mode: 'insensitive' } }] });
  if (query.alumni === 'false') and.push({ vitAlumni: false, NOT: { school: { contains: 'VIT', mode: 'insensitive' } } });
  const sources = csv(query.source).filter((s) => isOneOf(CONTACT_SOURCES, s));
  if (sources.length) and.push({ source: { in: sources } });

  const dueWhere: Prisma.NetworkingContactWhereInput = {
    status: { notIn: ['REPLIED', 'REFERRED', 'NOT_INTERESTED'] },
    OR: [{ status: 'FOLLOW_UP_DUE' }, { nextFollowUpAt: { lte: now } }],
  };
  const statuses: string[] = csv(query.status).filter((s) => isOneOf(CONTACT_STATUSES, s));
  if (query.followUpDue === 'true') and.push(dueWhere);

  const q = query.q?.trim();
  if (q) {
    const contains = { contains: q, mode: 'insensitive' as const };
    and.push({
      OR: [
        { name: contains },
        { company: contains },
        { role: contains },
        { headline: contains },
        { notes: contains },
        { email: contains },
        { school: contains },
      ],
    });
  }

  const rows = await prisma.networkingContact.findMany({
    where: and.length ? { AND: and } : {},
    include: CONTACT_INCLUDE,
    orderBy: { updatedAt: 'desc' },
  });
  let dtos = await toDtos(rows, now);
  // Status filter uses the status the user sees (FOLLOW_UP_DUE is derived).
  if (statuses.length) dtos = dtos.filter((d) => (statuses as string[]).includes(d.effectiveStatus));

  const sort: ContactSort = isOneOf(SORTS, query.sort) ? query.sort : 'priority';
  const byUpdated = (a: ContactDto, b: ContactDto) => b.updatedAt.getTime() - a.updatedAt.getTime();
  const byPriority = (a: ContactDto, b: ContactDto) => b.priority.score - a.priority.score || byUpdated(a, b);
  const comparators: Record<ContactSort, (a: ContactDto, b: ContactDto) => number> = {
    priority: byPriority,
    recent: byUpdated,
    company: (a, b) => (a.companyKey || '').localeCompare(b.companyKey || '') || byPriority(a, b),
    followUp: (a, b) => {
      const ta = a.nextFollowUpAt?.getTime() ?? Infinity;
      const tb = b.nextFollowUpAt?.getTime() ?? Infinity;
      return Number(b.followUpDue) - Number(a.followUpDue) || ta - tb || byPriority(a, b);
    },
  };
  dtos.sort(comparators[sort]);

  const limit = Number(query.limit);
  return Number.isFinite(limit) && limit > 0 ? dtos.slice(0, Math.min(limit, 500)) : dtos;
}

export async function contactFacets(now = new Date()) {
  const rows = await prisma.networkingContact.findMany({ include: { messages: { select: { type: true, status: true, sentAt: true } } } });
  const companies = new Map<string, { companyKey: string; company: string; count: number }>();
  const status: Record<string, number> = {};
  const persona: Record<string, number> = {};
  const source: Record<string, number> = {};
  let alumni = 0;
  let followUpDue = 0;
  for (const r of rows) {
    const key = r.companyKey || companyKey(r.company);
    const entry = companies.get(key) || { companyKey: key, company: r.company, count: 0 };
    entry.count++;
    companies.set(key, entry);
    const eff = effectiveStatus(r, now);
    status[eff] = (status[eff] || 0) + 1;
    persona[r.persona] = (persona[r.persona] || 0) + 1;
    source[r.source] = (source[r.source] || 0) + 1;
    if (r.vitAlumni || mentionsVit(r.school)) alumni++;
    if (isFollowUpDue(r, now)) followUpDue++;
  }
  return {
    total: rows.length,
    alumni,
    followUpDue,
    status,
    persona,
    source,
    companies: [...companies.values()].sort((a, b) => a.company.localeCompare(b.company)),
  };
}

/** For application cards: counts and the 3 highest-priority contacts per company key. */
export async function contactsByCompany(rawKeys: string[]) {
  const keys = [...new Set(rawKeys.map((k) => companyKey(k) || k.trim()).filter(Boolean))].slice(0, 200);
  const result: Record<string, { count: number; alumniCount: number; topContacts: ContactSummary[] }> = {};
  for (const k of keys) result[k] = { count: 0, alumniCount: 0, topContacts: [] };
  if (!keys.length) return result;
  const rows = await prisma.networkingContact.findMany({ where: { companyKey: { in: keys } }, include: CONTACT_INCLUDE });
  const dtos = await toDtos(rows);
  dtos.sort((a, b) => b.priority.score - a.priority.score);
  for (const d of dtos) {
    const bucket = result[d.companyKey];
    if (!bucket) continue;
    bucket.count++;
    if (d.vitAlumni || mentionsVit(d.school)) bucket.alumniCount++;
    if (bucket.topContacts.length < 3) bucket.topContacts.push(summarize(d));
  }
  return result;
}

export interface ContactSummary {
  id: string;
  name: string;
  role: string;
  company: string;
  persona: string;
  vitAlumni: boolean;
  status: string;
  effectiveStatus: string;
  linkedinUrl: string | null;
  xUrl: string | null;
  email: string | null;
  priority: number;
  followUpDue: boolean;
}

function summarize(d: ContactDto): ContactSummary {
  return {
    id: d.id,
    name: d.name,
    role: d.role,
    company: d.company,
    persona: d.persona,
    vitAlumni: d.vitAlumni || mentionsVit(d.school),
    status: d.status,
    effectiveStatus: d.effectiveStatus,
    linkedinUrl: d.linkedinUrl,
    xUrl: d.xUrl,
    email: d.email,
    priority: d.priority.score,
    followUpDue: d.followUpDue,
  };
}

// ---------------------------------------------------------------------------------------------
// Create / update / dedupe / merge
// ---------------------------------------------------------------------------------------------

const EDITABLE = [
  'name',
  'company',
  'role',
  'headline',
  'team',
  'linkedinUrl',
  'xUrl',
  'githubUrl',
  'email',
  'emailSource',
  'school',
  'persona',
  'vitAlumni',
  'notes',
  'targetJobId',
  'status',
  'outreachAngle',
  'nextFollowUpAt',
  'source',
] as const;

const text = (v: unknown, max = 500): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/**
 * Validates and normalises a create/update body. Only keys present in `body` are returned
 * (so PATCH leaves other fields alone). Throws HttpError(400) on invalid input.
 */
export async function normalizeContactInput(body: Record<string, unknown>, mode: 'create' | 'update') {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const data: Record<string, unknown> = {};
  const errors: Record<string, string> = {};

  if (mode === 'create' || has('name')) {
    const name = text(body.name, 120);
    if (!name) errors.name = 'Name is required';
    else data.name = name;
  }
  if (mode === 'create' || has('company')) {
    const company = text(body.company, 120);
    if (!company) errors.company = 'Company is required';
    else {
      data.company = company;
      data.companyKey = companyKey(company);
    }
  }
  if (mode === 'create' || has('role')) data.role = text(body.role, 150) ?? '';
  for (const k of ['headline', 'team', 'notes', 'outreachAngle'] as const) {
    if (has(k)) data[k] = text(body[k], k === 'notes' ? 5000 : 500);
  }

  const urlFields: [string, (v: unknown) => ReturnType<typeof normalizeLinkedinUrl>][] = [
    ['linkedinUrl', normalizeLinkedinUrl],
    ['xUrl', normalizeXUrl],
    ['githubUrl', normalizeGithubUrl],
    ['email', normalizeEmail],
  ];
  for (const [k, fn] of urlFields) {
    if (!has(k)) continue;
    const r = fn(body[k]);
    if (!r.ok) errors[k] = r.error;
    else data[k] = r.value;
  }
  if (has('email')) {
    if (!data.email) data.emailSource = null;
    else data.emailSource = isOneOf(EMAIL_SOURCES, body.emailSource) ? body.emailSource : 'manual';
  }

  if (has('school')) data.school = text(body.school, 120);
  if (has('persona')) {
    if (body.persona && !isOneOf(PERSONAS, body.persona)) errors.persona = 'Unknown persona';
    else if (body.persona) data.persona = body.persona;
  }
  if (has('status')) {
    if (!isOneOf(CONTACT_STATUSES, body.status)) errors.status = 'Unknown status';
    else data.status = body.status;
  }
  if (has('source')) {
    if (!isOneOf(CONTACT_SOURCES, body.source)) errors.source = 'Unknown source';
    else data.source = body.source;
  }
  if (has('nextFollowUpAt')) {
    const d = body.nextFollowUpAt ? new Date(String(body.nextFollowUpAt)) : null;
    if (d && isNaN(d.getTime())) errors.nextFollowUpAt = 'Invalid date';
    else data.nextFollowUpAt = d;
  }
  if (has('targetJobId')) {
    const id = text(body.targetJobId, 64);
    if (id && !(await prisma.jobListing.findUnique({ where: { id }, select: { id: true } }))) errors.targetJobId = 'Job not found';
    else data.targetJobId = id;
  }

  // Infer persona/school from role + headline unless the user chose them.
  if (mode === 'create') {
    const blob = `${data.role || ''} ${data.headline || ''}`;
    if (!data.persona) data.persona = inferPersona(blob);
    if (!has('school') || !data.school) data.school = (data.school as string | null) || inferSchool(blob);
  }
  if (has('vitAlumni')) data.vitAlumni = Boolean(body.vitAlumni);
  else if (has('school') || mode === 'create') data.vitAlumni = mentionsVit(data.school as string | null);

  if (Object.keys(errors).length) {
    throw new HttpError(400, Object.values(errors)[0], { fieldErrors: errors });
  }
  return data;
}

/** Existing contact that is the same person (LinkedIn URL, else name + company). */
export async function findDuplicate(
  candidate: { linkedinUrl?: string | null; githubUrl?: string | null; name?: string; companyKey?: string },
  excludeId?: string
): Promise<{ contact: NetworkingContact; reason: 'linkedinUrl' | 'githubUrl' | 'name+company' } | null> {
  const not = excludeId ? { NOT: { id: excludeId } } : {};
  if (candidate.linkedinUrl) {
    const hit = await prisma.networkingContact.findFirst({
      where: { ...not, OR: [{ linkedinUrl: candidate.linkedinUrl }, { profileUrl: candidate.linkedinUrl }] },
    });
    if (hit) return { contact: hit, reason: 'linkedinUrl' };
  }
  if (candidate.githubUrl) {
    const hit = await prisma.networkingContact.findFirst({
      where: { ...not, githubUrl: { equals: candidate.githubUrl, mode: 'insensitive' } },
    });
    if (hit) return { contact: hit, reason: 'githubUrl' };
  }
  if (candidate.name && candidate.companyKey) {
    const sameCompany = await prisma.networkingContact.findMany({ where: { ...not, companyKey: candidate.companyKey } });
    const target = normalizeName(candidate.name);
    const hit = sameCompany.find((c) => normalizeName(c.name) === target);
    if (hit) return { contact: hit, reason: 'name+company' };
  }
  return null;
}

export async function createContact(body: Record<string, unknown>) {
  const data = await normalizeContactInput(body, 'create');
  const source = (data.source as string) || 'MANUAL';
  data.source = source;
  data.verified = source === 'MANUAL';
  if (data.status && data.status !== 'RESEARCHED') Object.assign(data, transitionData(data.status as any));

  const dup = await findDuplicate(data as any);
  if (dup && !(body.allowDuplicate === true && dup.reason === 'name+company')) {
    throw new HttpError(409, `Looks like ${dup.contact.name} at ${dup.contact.company} is already saved.`, {
      duplicate: await getContactDto(dup.contact.id),
      reason: dup.reason,
      canForce: dup.reason === 'name+company',
    });
  }

  const created = await prisma.networkingContact.create({ data: data as Prisma.NetworkingContactUncheckedCreateInput });
  return (await getContactDto(created.id))!;
}

export async function updateContact(id: string, body: Record<string, unknown>) {
  const existing = await prisma.networkingContact.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Contact not found');
  const data = await normalizeContactInput(body, 'update');
  // A status change through PATCH still gets the workflow dates.
  if (data.status && data.status !== existing.status) {
    Object.assign(data, { ...transitionData(data.status as any), ...('nextFollowUpAt' in data ? { nextFollowUpAt: data.nextFollowUpAt } : {}) });
  }
  if (data.linkedinUrl || data.githubUrl) {
    const dup = await findDuplicate({ linkedinUrl: data.linkedinUrl as string, githubUrl: data.githubUrl as string }, id);
    if (dup) {
      throw new HttpError(409, `${dup.contact.name} already has this ${dup.reason === 'githubUrl' ? 'GitHub' : 'LinkedIn'} URL. Merge the two contacts instead.`, {
        duplicate: await getContactDto(dup.contact.id),
        reason: dup.reason,
        canForce: false,
      });
    }
  }
  if (existing.source === 'MANUAL' || Object.keys(data).some((k) => ['name', 'company', 'role', 'linkedinUrl'].includes(k))) {
    data.verified = true;
  }
  await prisma.networkingContact.update({ where: { id }, data: data as Prisma.NetworkingContactUncheckedUpdateInput });
  return (await getContactDto(id))!;
}

const STATUS_RANK: Record<string, number> = Object.fromEntries(CONTACT_STATUSES.map((s, i) => [s, i]));

/** Merges `otherId` into `id`: fills blanks, appends notes, moves messages/emails, deletes other. */
export async function mergeContacts(id: string, otherId: string) {
  if (id === otherId) throw new HttpError(400, 'Cannot merge a contact into itself');
  const [keep, other] = await Promise.all([
    prisma.networkingContact.findUnique({ where: { id } }),
    prisma.networkingContact.findUnique({ where: { id: otherId } }),
  ]);
  if (!keep || !other) throw new HttpError(404, 'Contact not found');

  const data: Record<string, unknown> = {};
  for (const k of EDITABLE) {
    if (k === 'status' || k === 'vitAlumni' || k === 'persona' || k === 'source' || k === 'nextFollowUpAt') continue;
    const kv = (keep as any)[k];
    const ov = (other as any)[k];
    if ((kv === null || kv === undefined || kv === '') && ov) data[k] = ov;
  }
  if (keep.persona === 'OTHER' && other.persona !== 'OTHER') data.persona = other.persona;
  if (other.vitAlumni) data.vitAlumni = true;
  if (other.verified) data.verified = true;
  if (keep.notes && other.notes && keep.notes !== other.notes) data.notes = `${keep.notes}\n\n${other.notes}`;
  if (keep.status !== 'NOT_INTERESTED' && (STATUS_RANK[other.status] ?? 0) > (STATUS_RANK[keep.status] ?? 0) && other.status !== 'NOT_INTERESTED') {
    data.status = other.status;
  }
  for (const k of ['requestSentAt', 'acceptedAt'] as const) {
    if (!keep[k] && other[k]) data[k] = other[k];
  }
  if (other.lastContactAt && (!keep.lastContactAt || other.lastContactAt > keep.lastContactAt)) data.lastContactAt = other.lastContactAt;
  if (!keep.nextFollowUpAt && other.nextFollowUpAt) data.nextFollowUpAt = other.nextFollowUpAt;
  if (data.company) data.companyKey = companyKey(data.company as string);
  const linkedin = (data.linkedinUrl as string) || keep.linkedinUrl;
  // Clear unique-ish values on the other row first so nothing collides.
  await prisma.$transaction([
    prisma.networkingMessage.updateMany({ where: { contactId: otherId }, data: { contactId: id } }),
    prisma.emailEvent.updateMany({ where: { networkingContactId: otherId }, data: { networkingContactId: id } }),
    prisma.networkingContact.delete({ where: { id: otherId } }),
    prisma.networkingContact.update({ where: { id }, data: { ...data, ...(linkedin ? { linkedinUrl: linkedin } : {}) } }),
  ]);
  return (await getContactDto(id))!;
}

/** Groups of contacts that look like the same person. */
export async function findDuplicateGroups() {
  const rows = await prisma.networkingContact.findMany({
    select: { id: true, name: true, company: true, companyKey: true, linkedinUrl: true, githubUrl: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const keys = [
      r.linkedinUrl ? `li:${r.linkedinUrl}` : null,
      r.githubUrl ? `gh:${r.githubUrl.toLowerCase()}` : null,
      `nc:${normalizeName(r.name)}|${r.companyKey || companyKey(r.company)}`,
    ].filter(Boolean) as string[];
    for (const k of keys) groups.set(k, [...(groups.get(k) || []), r]);
  }
  const seen = new Set<string>();
  const out: { reason: string; contacts: typeof rows }[] = [];
  for (const [k, list] of groups) {
    if (list.length < 2) continue;
    const sig = list.map((c) => c.id).sort().join(',');
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ reason: k.startsWith('li:') ? 'Same LinkedIn URL' : k.startsWith('gh:') ? 'Same GitHub URL' : 'Same name and company', contacts: list });
  }
  return out;
}

export async function deleteContact(id: string) {
  const existing = await prisma.networkingContact.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new HttpError(404, 'Contact not found');
  await prisma.$transaction([
    prisma.emailEvent.updateMany({ where: { networkingContactId: id }, data: { networkingContactId: null } }),
    prisma.networkingMessage.deleteMany({ where: { contactId: id } }),
    prisma.networkingContact.delete({ where: { id } }),
  ]);
}
