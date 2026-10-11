import { Router } from 'express';
import { prisma } from '../db';

export const jobsRouter = Router();

jobsRouter.get('/jobs', async (req, res) => {
  try {
    const { status, minScore, search, source, sortBy, sortOrder } = req.query;

    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = String(status);
    }
    if (minScore) {
      where.score = { gte: parseInt(String(minScore), 10) };
    }
    if (source) {
      where.source = { contains: String(source), mode: 'insensitive' };
    }
    if (search) {
      const searchStr = String(search);
      where.OR = [
        { title: { contains: searchStr, mode: 'insensitive' } },
        { company: { contains: searchStr, mode: 'insensitive' } },
        { description: { contains: searchStr, mode: 'insensitive' } },
      ];
    }

    const orderBy: any = {};
    const validSortFields = ['createdAt', 'score', 'title', 'company', 'retrievedAt'];
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

jobsRouter.get('/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const job = await prisma.jobListing.findUnique({
      where: { id },
      include: {
        applications: true,
      },
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);
  } catch (error) {
    console.error('Error fetching job by id:', error);
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});
