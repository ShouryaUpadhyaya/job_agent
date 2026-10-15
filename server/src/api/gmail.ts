import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { gmailService, GmailError } from '../email/service';
import { buildGmailSummary, clampDays } from '../email/summary';
import { classifyJobEmail, isClassification } from '../email/classifier';
import { prisma } from '../db';

export const gmailRouter = Router();

function fail(res: Response, error: unknown) {
  if (error instanceof GmailError) {
    return res.status(error.httpStatus).json({ error: error.message, code: error.code, fix: error.fix });
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error('[gmail]', message);
  return res.status(500).json({ error: message });
}

const frontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

gmailRouter.get('/gmail/status', async (_req: Request, res: Response) => {
  try {
    res.json(await gmailService.getStatus());
  } catch (error) {
    fail(res, error);
  }
});

gmailRouter.get('/gmail/auth-url', (_req: Request, res: Response) => {
  try {
    res.json({ url: gmailService.getAuthUrl() });
  } catch (error) {
    fail(res, error);
  }
});

gmailRouter.get('/gmail/oauth2callback', async (req: Request, res: Response) => {
  const back = (params: Record<string, string>) => {
    const q = new URLSearchParams({ tab: 'GMAIL', ...params });
    res.redirect(`${frontendUrl()}/?${q.toString()}`);
  };
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  if (typeof req.query.error === 'string') return back({ auth: 'error', reason: req.query.error === 'access_denied' ? 'You declined access on the Google consent screen.' : req.query.error });
  if (!code) return back({ auth: 'error', reason: 'Google did not return an authorization code.' });
  try {
    await gmailService.handleOAuthCallback(code, state);
    back({ auth: 'success' });
  } catch (error: any) {
    console.error('[gmail] OAuth callback failed:', error?.message);
    back({ auth: 'error', reason: String(error?.message || 'Sign-in failed').slice(0, 200) });
  }
});

gmailRouter.post('/gmail/sync', async (_req: Request, res: Response) => {
  try {
    res.json(await gmailService.syncInbox());
  } catch (error) {
    fail(res, error);
  }
});

gmailRouter.get('/gmail/summary', async (req: Request, res: Response) => {
  try {
    res.json(await buildGmailSummary(clampDays(req.query.days), new Date(), { ai: req.query.ai !== '0' }));
  } catch (error) {
    fail(res, error);
  }
});

/**
 * Events, newest first. Filters: classification, importance (HIGH|NORMAL|LOW),
 * linked (linked|unlinked), company, demo (exclude [default] | include | only), limit (1-200).
 */
gmailRouter.get('/gmail/events', async (req: Request, res: Response) => {
  try {
    const q = req.query;
    const where: Prisma.EmailEventWhereInput = {};
    const and: Prisma.EmailEventWhereInput[] = [];
    if (typeof q.classification === 'string' && q.classification !== 'ALL') {
      if (!isClassification(q.classification)) return res.status(400).json({ error: `Unknown classification ${q.classification}` });
      where.classification = q.classification;
    }
    if (typeof q.importance === 'string' && q.importance !== 'ALL') {
      if (!['HIGH', 'NORMAL', 'LOW'].includes(q.importance)) return res.status(400).json({ error: 'importance must be HIGH, NORMAL or LOW' });
      where.importance = q.importance;
    }
    if (q.linked === 'linked') and.push({ OR: [{ jobApplicationId: { not: null } }, { networkingContactId: { not: null } }] });
    if (q.linked === 'unlinked') and.push({ jobApplicationId: null, networkingContactId: null });
    // Deep link: one event by id (demo or not).
    const byId = typeof q.id === 'string' && q.id.trim() ? q.id.trim() : null;
    if (byId) where.id = byId;
    if (typeof q.company === 'string' && q.company.trim()) where.company = { contains: q.company.trim(), mode: 'insensitive' };
    const demo = typeof q.demo === 'string' ? q.demo : q.includeDemo === 'true' ? 'include' : 'exclude';
    if (demo === 'only') where.isDemo = true;
    else if (demo !== 'include' && !byId) where.isDemo = false;
    if (and.length) where.AND = and;

    const parsed = parseInt(String(q.limit ?? ''), 10);
    const take = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 50;

    const events = await prisma.emailEvent.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take,
      include: {
        jobApplication: { select: { id: true, stage: true, jobListing: { select: { title: true, company: true } } } },
        networkingContact: { select: { id: true, name: true, company: true, status: true } },
      },
    });
    // The body is large and only used server-side; the list shows the snippet.
    res.json(events.map(({ body: _body, ...rest }) => rest));
  } catch (error) {
    fail(res, error);
  }
});

gmailRouter.post('/gmail/disconnect', async (_req: Request, res: Response) => {
  try {
    res.json(await gmailService.disconnect());
  } catch (error) {
    fail(res, error);
  }
});

/** Classifier preview: nothing is stored. */
gmailRouter.post('/gmail/classify', (req: Request, res: Response) => {
  const { sender, senderName, subject, body, snippet } = req.body || {};
  if (!subject || typeof subject !== 'string') return res.status(400).json({ error: 'subject is required' });
  res.json(classifyJobEmail({ subject, body: body || snippet || '', sender: sender || '', senderName }));
});

/** Stores a hand-written test email as a demo event (isDemo, no side effects). */
gmailRouter.post('/gmail/simulate', async (req: Request, res: Response) => {
  try {
    const { sender, senderName, subject, snippet, body } = req.body || {};
    if (!subject || !sender) return res.status(400).json({ error: 'sender and subject are required' });
    const messageId = `demo-sim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const result = await gmailService.processEmail({ messageId, sender, senderName, subject, snippet, body, receivedAt: new Date() }, { isDemo: true });
    res.status(201).json(result);
  } catch (error) {
    fail(res, error);
  }
});

gmailRouter.post('/gmail/demo', async (_req: Request, res: Response) => {
  try {
    res.status(201).json(await gmailService.loadDemo());
  } catch (error) {
    fail(res, error);
  }
});

gmailRouter.delete('/gmail/demo', async (_req: Request, res: Response) => {
  try {
    res.json(await gmailService.clearDemo());
  } catch (error) {
    fail(res, error);
  }
});
