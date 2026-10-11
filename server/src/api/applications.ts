import { Router } from 'express';
import { prisma } from '../db';

export const applicationsRouter = Router();

applicationsRouter.get('/applications', async (req, res) => {
  try {
    const applications = await prisma.jobApplication.findMany({
      include: {
        jobListing: true,
        candidateProfile: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(applications);
  } catch (error) {
    console.error('Error fetching applications:', error);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

applicationsRouter.post('/applications', async (req, res) => {
  try {
    const { jobListingId, candidateProfileId, status, notes } = req.body;
    
    if (!jobListingId || !candidateProfileId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const application = await prisma.jobApplication.create({
      data: {
        jobListingId,
        candidateProfileId,
        status: status || 'DRAFT',
        notes,
      },
    });

    res.status(201).json(application);
  } catch (error) {
    console.error('Error creating application:', error);
    res.status(500).json({ error: 'Failed to create application' });
  }
});

applicationsRouter.post('/applications/:id/submit', async (req, res) => {
  try {
    const { id } = req.params;
    const application = await prisma.jobApplication.findUnique({ where: { id } });
    if (!application) return res.status(404).json({ error: 'Not found' });

    if (!application.isApproved) {
      return res.status(403).json({ error: 'Application cannot be submitted without explicit approval' });
    }

    const updated = await prisma.jobApplication.update({
      where: { id },
      data: { status: 'SUBMITTED' }
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit application' });
  }
});
