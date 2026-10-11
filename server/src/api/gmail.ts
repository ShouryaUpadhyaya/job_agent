import { Router, Request, Response } from 'express';
import { gmailService } from '../email/service';
import { prisma } from '../db';

export const gmailRouter = Router();

// 1. Connection status
gmailRouter.get('/gmail/status', async (req: Request, res: Response) => {
  try {
    const status = await gmailService.getStatus();
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Generate Google OAuth URL
gmailRouter.get('/gmail/auth-url', (req: Request, res: Response) => {
  try {
    const url = gmailService.getAuthUrl();
    res.json({ url });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. OAuth callback handler
gmailRouter.get('/gmail/oauth2callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  if (!code) {
    return res.redirect(`${frontendUrl}?tab=GMAIL&error=no_code`);
  }

  try {
    await gmailService.handleOAuthCallback(code);
    res.redirect(`${frontendUrl}?tab=GMAIL&auth=success`);
  } catch (error: any) {
    console.error('[GmailOAuth] Callback failed:', error);
    res.redirect(`${frontendUrl}?tab=GMAIL&error=${encodeURIComponent(error.message)}`);
  }
});

// 4. Trigger Mailbox Sync
gmailRouter.post('/gmail/sync', async (req: Request, res: Response) => {
  try {
    const result = await gmailService.syncInbox();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 5. List Email Events
gmailRouter.get('/gmail/events', async (req: Request, res: Response) => {
  try {
    const { classification, company, limit } = req.query;
    const where: any = {};

    if (classification && typeof classification === 'string') {
      where.classification = classification;
    }

    if (company && typeof company === 'string') {
      where.company = { contains: company, mode: 'insensitive' };
    }

    const events = await prisma.emailEvent.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take: limit ? parseInt(limit as string, 10) : 50,
      include: {
        jobApplication: {
          include: { jobListing: true },
        },
        networkingContact: true,
      },
    });

    res.json(events);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Disconnect Account
gmailRouter.post('/gmail/disconnect', async (req: Request, res: Response) => {
  try {
    const result = await gmailService.disconnect();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Simulate incoming email event (for testing & verification)
gmailRouter.post('/gmail/simulate', async (req: Request, res: Response) => {
  try {
    const { sender, senderName, subject, snippet, body } = req.body;
    if (!subject || !sender) {
      return res.status(400).json({ error: 'sender and subject are required' });
    }

    const messageId = `simulated-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const result = await gmailService.processEmail({
      messageId,
      sender,
      senderName,
      subject,
      snippet,
      body,
      receivedAt: new Date(),
    });

    res.status(201).json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
