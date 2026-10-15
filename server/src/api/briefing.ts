import { Router, Request, Response } from 'express';
import { HISTORY_DEFAULT, HISTORY_MAX, dailyBriefingService } from '../briefing/summary';

export const briefingRouter = Router();

function fail(res: Response, label: string, error: unknown) {
  console.error(`[briefing] ${label}:`, error);
  res.status(500).json({ error: `Failed to ${label}` });
}

/** Parses ?limit= : default 14, clamped to 60; anything that isn't a positive integer is a 400. */
export function parseHistoryLimit(raw: unknown): number | null {
  if (raw === undefined || raw === '') return HISTORY_DEFAULT;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || !/^\d{1,4}$/.test(value.trim())) return null;
  const n = parseInt(value, 10);
  if (n < 1) return null;
  return Math.min(n, HISTORY_MAX);
}

// Today's (IST) briefing, generated on first view when the day has none yet.
briefingRouter.get('/briefing/today', async (_req: Request, res: Response) => {
  try {
    res.json(await dailyBriefingService.getToday());
  } catch (error) {
    fail(res, 'load today\'s briefing', error);
  }
});

// A fresh build that is not saved (the UI's live view).
briefingRouter.get('/briefing/live', async (_req: Request, res: Response) => {
  try {
    res.json(await dailyBriefingService.live());
  } catch (error) {
    fail(res, 'build the live briefing', error);
  }
});

// Regenerate and save today's briefing.
briefingRouter.post('/briefing/generate', async (_req: Request, res: Response) => {
  try {
    res.json(await dailyBriefingService.generate(new Date(), 'manual'));
  } catch (error) {
    fail(res, 'generate the briefing', error);
  }
});

briefingRouter.get('/briefing/history', async (req: Request, res: Response) => {
  const limit = parseHistoryLimit(req.query.limit);
  if (limit === null) {
    return res.status(400).json({ error: `limit must be a whole number between 1 and ${HISTORY_MAX}` });
  }
  try {
    res.json(await dailyBriefingService.getHistory(limit));
  } catch (error) {
    fail(res, 'load briefing history', error);
  }
});
