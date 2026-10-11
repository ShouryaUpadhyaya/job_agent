import { Router, Request, Response } from 'express';
import { dailyBriefingService } from '../briefing/summary';

export const briefingRouter = Router();

// 1. Get today's daily briefing
briefingRouter.get('/briefing/today', async (req: Request, res: Response) => {
  try {
    const summary = await dailyBriefingService.getSummary();
    res.json(summary);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Force generate today's daily briefing
briefingRouter.post('/briefing/generate', async (req: Request, res: Response) => {
  try {
    const briefing = await dailyBriefingService.generateDailyBriefing();
    res.json(briefing);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Get briefing history
briefingRouter.get('/briefing/history', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 14;
    const history = await dailyBriefingService.getHistory(limit);
    res.json(history);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
