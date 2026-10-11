import express from 'express';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { jobsRouter } from './api/jobs';
import { profilesRouter } from './api/profiles';
import { applicationsRouter } from './api/applications';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import { copilotRouter } from "./api/copilot";

const app = express();
app.use(cors());
app.use(express.json());

import { prisma } from './db';

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
app.use('/api', applicationsRouter);

app.use("/api", copilotRouter);

export { app, prisma };
