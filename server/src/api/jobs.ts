import { Router } from 'express';
import { prisma } from '../db';

export const jobsRouter = Router();

jobsRouter.get('/jobs', async (req, res) => {
  try {
    const { status, minScore, sortBy, sortOrder } = req.query;

    const where: any = {};
    if (status) {
      where.status = String(status);
    }
    if (minScore) {
      where.score = { gte: parseInt(String(minScore), 10) };
    }

    const orderBy: any = {};
    const validSortFields = ['createdAt', 'score', 'title', 'company'];
    const field = validSortFields.includes(String(sortBy)) ? String(sortBy) : 'createdAt';
    const order = String(sortOrder).toLowerCase() === 'asc' ? 'asc' : 'desc';
    
    orderBy[field] = order;

    const jobs = await prisma.jobListing.findMany({
      where,
      orderBy,
    });
    res.json(jobs);
  } catch (error) {
    console.error('Error fetching jobs:', error);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});
