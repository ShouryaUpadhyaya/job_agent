import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { companyKey } from '../lib/company';
import { getActiveProfile } from '../lib/profile';
import { MESSAGE_TYPES, isOneOf } from '../networking/constants';
import {
  contactFacets,
  contactsByCompany,
  createContact,
  deleteContact,
  findDuplicateGroups,
  getContactDto,
  listContacts,
  mergeContacts,
  updateContact,
} from '../networking/contacts';
import { networkingCrmService } from '../networking/crm';
import { HttpError } from '../networking/errors';
import { fetchGithubUser, findGithubPeople } from '../networking/github';
import { generateMessage, jobOptionsForCompany, markMessageSent, updateMessage } from '../networking/messages';
import { parseHeadline } from '../networking/parse';
import { buildPeopleLinks } from '../networking/peopleLinks';

export const networkingRouter = Router();

function fail(res: Response, error: unknown) {
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message, ...(error.body || {}) });
  const status = (error as { status?: number })?.status;
  if (status && status >= 400 && status < 500) return res.status(status).json({ error: (error as Error).message });
  if ((error as { code?: string })?.code === 'P2025') return res.status(404).json({ error: 'Not found' });
  console.error('[networking]', error);
  return res.status(500).json({ error: (error as Error)?.message || 'Internal error' });
}

const qs = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

// ---- Contacts -------------------------------------------------------------------------------

/**
 * GET /networking/contacts?companyKey=a,b&company=&sort=priority|recent|company|followUp
 *   &persona=ENGINEER,FULLSTACK&alumni=true&status=&source=&followUpDue=true&q=&limit=
 */
networkingRouter.get('/networking/contacts', async (req: Request, res: Response) => {
  try {
    const q = req.query;
    res.json(
      await listContacts({
        companyKey: qs(q.companyKey),
        company: qs(q.company),
        persona: qs(q.persona),
        alumni: qs(q.alumni) ?? (q.vitAlumni !== undefined ? qs(q.vitAlumni) : undefined),
        status: qs(q.status),
        source: qs(q.source),
        followUpDue: qs(q.followUpDue),
        q: qs(q.q) ?? qs(q.search),
        sort: qs(q.sort),
        limit: qs(q.limit),
      })
    );
  } catch (error) {
    fail(res, error);
  }
});

networkingRouter.get('/networking/facets', async (_req: Request, res: Response) => {
  try {
    res.json(await contactFacets());
  } catch (error) {
    fail(res, error);
  }
});

/** GET /networking/by-company?keys=razorpay,zepto → { razorpay: { count, alumniCount, topContacts[3] } } */
networkingRouter.get('/networking/by-company', async (req: Request, res: Response) => {
  try {
    const keys = (qs(req.query.keys) || '').split(',').filter((k) => k.trim());
    res.json(await contactsByCompany(keys));
  } catch (error) {
    fail(res, error);
  }
});

networkingRouter.get('/networking/duplicates', async (_req: Request, res: Response) => {
  try {
    res.json({ groups: await findDuplicateGroups() });
  } catch (error) {
    fail(res, error);
  }
});

/** Guesses role/company/persona/school from a pasted LinkedIn headline. */
networkingRouter.post('/networking/parse-headline', (req: Request, res: Response) => {
  res.json(parseHeadline(typeof req.body?.text === 'string' ? req.body.text.slice(0, 500) : ''));
});

networkingRouter.post('/networking/contacts', async (req: Request, res: Response) => {
  try {
    const body = { ...(req.body || {}) };
    // Contacts created here are typed by the user; GitHub/Gmail have their own paths.
    if (body.source === 'GITHUB') delete body.source;
    if (body.emailSource === 'github') delete body.emailSource;
    res.status(201).json(await createContact(body));
  } catch (error) {
    fail(res, error);
  }
});

networkingRouter.get('/networking/contacts/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const contact = await getContactDto(id);
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    const emailEvents = await prisma.emailEvent.findMany({
      where: { networkingContactId: id },
      orderBy: { receivedAt: 'desc' },
      select: { id: true, subject: true, sender: true, senderName: true, receivedAt: true, classification: true },
    });
    res.json({ ...contact, emailEvents });
  } catch (error) {
    fail(res, error);
  }
});

networkingRouter.patch('/networking/contacts/:id', async (req: Request, res: Response) => {
  try {
    const body = { ...(req.body || {}) };
    delete body.source;
    res.json(await updateContact(String(req.params.id), body));
  } catch (error) {
    fail(res, error);
  }
});

networkingRouter.delete('/networking/contacts/:id', async (req: Request, res: Response) => {
  try {
    await deleteContact(String(req.params.id));
    res.json({ message: 'Contact deleted' });
  } catch (error) {
    fail(res, error);
  }
});

networkingRouter.post('/networking/contacts/:id/transition', async (req: Request, res: Response) => {
  try {
    const { newStage, notes } = req.body || {};
    if (!newStage) return res.status(400).json({ error: 'newStage is required' });
    const id = String(req.params.id);
    await networkingCrmService.transitionStage(id, newStage, notes);
    res.json(await getContactDto(id));
  } catch (error) {
    fail(res, error);
  }
});

networkingRouter.post('/networking/contacts/:id/merge', async (req: Request, res: Response) => {
  try {
    const otherId = req.body?.otherId;
    if (!otherId || typeof otherId !== 'string') return res.status(400).json({ error: 'otherId is required' });
    res.json(await mergeContacts(String(req.params.id), otherId));
  } catch (error) {
    fail(res, error);
  }
});

// ---- Messages -------------------------------------------------------------------------------

/** POST { type: CONNECTION_NOTE|REFERRAL_ASK|FOLLOW_UP|THANK_YOU, jobListingId?, update? } */
networkingRouter.post('/networking/contacts/:id/messages/generate', async (req: Request, res: Response) => {
  try {
    const { type, jobListingId, update } = req.body || {};
    if (!isOneOf(MESSAGE_TYPES, type)) {
      return res.status(400).json({ error: `type must be one of ${MESSAGE_TYPES.join(', ')}` });
    }
    const result = await generateMessage(String(req.params.id), type, {
      jobListingId: typeof jobListingId === 'string' && jobListingId ? jobListingId : null,
      update: typeof update === 'string' ? update.slice(0, 400) : null,
    });
    res.json(result);
  } catch (error) {
    fail(res, error);
  }
});

networkingRouter.get('/networking/contacts/:id/job-options', async (req: Request, res: Response) => {
  try {
    const contact = await prisma.networkingContact.findUnique({ where: { id: String(req.params.id) } });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    res.json({ jobOptions: await jobOptionsForCompany(contact.companyKey || companyKey(contact.company)) });
  } catch (error) {
    fail(res, error);
  }
});

networkingRouter.patch('/networking/messages/:id', async (req: Request, res: Response) => {
  try {
    res.json(await updateMessage(String(req.params.id), req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

networkingRouter.post('/networking/messages/:id/mark-sent', async (req: Request, res: Response) => {
  try {
    const { message, contactId } = await markMessageSent(String(req.params.id));
    res.json({ message, contact: await getContactDto(contactId) });
  } catch (error) {
    fail(res, error);
  }
});

networkingRouter.delete('/networking/messages/:id', async (req: Request, res: Response) => {
  try {
    const msg = await prisma.networkingMessage.findUnique({ where: { id: String(req.params.id) } });
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.status === 'SENT') return res.status(409).json({ error: 'Sent messages are kept as history' });
    await prisma.networkingMessage.delete({ where: { id: msg.id } });
    res.json({ message: 'Draft deleted' });
  } catch (error) {
    fail(res, error);
  }
});

// ---- Finding people (links the user opens + GitHub public API) -----------------------------

networkingRouter.get('/networking/companies/:company/people-links', async (req: Request, res: Response) => {
  try {
    const company = String(req.params.company).trim();
    if (!company) return res.status(400).json({ error: 'company is required' });
    const profile = await getActiveProfile();
    res.json({
      company,
      companyKey: companyKey(company),
      school: profile?.school ?? null,
      links: buildPeopleLinks(company, { school: profile?.school, githubOrg: qs(req.query.githubOrg) || null }),
    });
  } catch (error) {
    fail(res, error);
  }
});

networkingRouter.get('/networking/companies/:company/github-people', async (req: Request, res: Response) => {
  try {
    const company = String(req.params.company).trim();
    if (!company) return res.status(400).json({ error: 'company is required' });
    const result = await findGithubPeople(company, qs(req.query.org) || null);
    const urls = result.people.map((p) => p.htmlUrl);
    const existing = urls.length
      ? await prisma.networkingContact.findMany({
          where: { OR: urls.map((u) => ({ githubUrl: { equals: u, mode: 'insensitive' as const } })) },
          select: { id: true, githubUrl: true },
        })
      : [];
    const byUrl = new Map(existing.map((e) => [(e.githubUrl || '').toLowerCase(), e.id]));
    res.json({
      company,
      ...result,
      people: result.people.map((p) => ({ ...p, existingContactId: byUrl.get(p.htmlUrl.toLowerCase()) ?? null })),
    });
  } catch (error) {
    fail(res, error);
  }
});

/**
 * POST { login } — adds a GitHub user as a contact at this company, using only fields from
 * their public GitHub profile (re-fetched server-side; email only if they published one).
 */
networkingRouter.post('/networking/companies/:company/github-people/add', async (req: Request, res: Response) => {
  try {
    const company = String(req.params.company).trim();
    const login = typeof req.body?.login === 'string' ? req.body.login.trim() : '';
    if (!company || !login) return res.status(400).json({ error: 'company and login are required' });
    const user = await fetchGithubUser(login).catch(() => null);
    if (!user) return res.status(404).json({ error: `GitHub user ${login} could not be loaded` });
    const contact = await createContact({
      name: user.name || user.login,
      company,
      role: '',
      headline: user.bio || null,
      githubUrl: user.html_url || `https://github.com/${user.login}`,
      xUrl: user.twitter_username ? `https://x.com/${user.twitter_username}` : null,
      email: user.email || null,
      emailSource: user.email ? 'github' : undefined,
      source: 'GITHUB',
      notes: [
        user.company ? `GitHub company: ${user.company}` : null,
        user.location ? `Location: ${user.location}` : null,
        user.blog ? `Website: ${user.blog}` : null,
      ]
        .filter(Boolean)
        .join('\n') || null,
    });
    res.status(201).json(contact);
  } catch (error) {
    fail(res, error);
  }
});

/**
 * Former "Generate 4 Leads" endpoint. It used to save made-up people; it now only returns the
 * search links so callers can find real people themselves.
 */
networkingRouter.post('/networking/generate-targets', async (req: Request, res: Response) => {
  const company = typeof req.body?.company === 'string' ? req.body.company.trim() : '';
  if (!company) return res.status(400).json({ error: 'company is required' });
  const profile = await getActiveProfile().catch(() => null);
  res.json({
    targets: [],
    createdContacts: [],
    links: buildPeopleLinks(company, { school: profile?.school }),
    message: 'Contacts are no longer generated. Open these searches and add the real people you find.',
  });
});
