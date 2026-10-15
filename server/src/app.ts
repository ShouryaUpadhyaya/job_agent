import express from 'express';
import cors from 'cors';
import { allowedOrigins, originGuard } from './lib/origin';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { prisma } from './db';
import { jobsRouter } from './api/jobs';
import { profilesRouter } from './api/profiles';
import { resumesRouter } from './api/resumes';
import { overviewRouter } from './api/overview';
import { applicationsRouter } from './api/applications';
import { copilotRouter } from './api/copilot';
import { syncRouter } from './api/sync';
import sourcesRouter from './api/sources';
import { gmailRouter } from './api/gmail';
import { networkingRouter } from './api/networking';
import { briefingRouter } from './api/briefing';
import { wellfoundAutoApplyRouter } from './api/wellfound';

const app = express();
app.use(originGuard());
app.use(cors({ origin: allowedOrigins() }));
app.use(express.json());

app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ok', database: 'connected' });
  } catch (error) {
    console.error('Database connection error:', error);
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

app.use('/api', jobsRouter);
app.use('/api', profilesRouter);
app.use('/api', resumesRouter);
app.use('/api', overviewRouter);
app.use('/api', applicationsRouter);
app.use('/api', copilotRouter);
app.use('/api', syncRouter);
app.use('/api', gmailRouter);
app.use('/api', networkingRouter);
app.use('/api', briefingRouter);
app.use('/api', wellfoundAutoApplyRouter);
app.use('/api/sources', sourcesRouter);

export { app, prisma };
