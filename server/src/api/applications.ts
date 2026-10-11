import { Router, Request, Response } from 'express';
import { prisma } from '../db';

export const applicationsRouter = Router();

// GET /api/applications - List all applications
applicationsRouter.get('/applications', async (req: Request, res: Response) => {
  try {
    const { stage, status } = req.query;

    const where: any = {};
    if (stage) where.stage = String(stage);
    if (status) where.status = String(status);

    const applications = await prisma.jobApplication.findMany({
      where,
      include: {
        jobListing: true,
        candidateProfile: true,
        documents: {
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(applications);
  } catch (error: any) {
    console.error('Error fetching applications:', error);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

// GET /api/applications/:id - Get single application
applicationsRouter.get('/applications/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const application = await prisma.jobApplication.findUnique({
      where: { id },
      include: {
        jobListing: true,
        candidateProfile: true,
        documents: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    res.json(application);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch application' });
  }
});

// POST /api/applications - Create a new application
applicationsRouter.post('/applications', async (req: Request, res: Response) => {
  try {
    let { jobListingId, candidateProfileId, status, stage, notes, isApproved } = req.body;

    if (!jobListingId) {
      return res.status(400).json({ error: 'Missing required field: jobListingId' });
    }

    if (!candidateProfileId) {
      const defaultProfile = await prisma.candidateProfile.findFirst({ orderBy: { id: 'asc' } });
      if (!defaultProfile) {
        return res.status(400).json({ error: 'No candidate profile found. Please create a profile first.' });
      }
      candidateProfileId = defaultProfile.id;
    }

    const application = await prisma.jobApplication.create({
      data: {
        jobListingId,
        candidateProfileId,
        status: status || 'DRAFT',
        stage: stage || 'BOOKMARKED',
        notes,
        isApproved: Boolean(isApproved),
      },
      include: {
        jobListing: true,
        candidateProfile: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: 'JOB_APPLICATION_CREATED',
        entityId: application.id,
        metadata: { jobListingId, stage: application.stage },
      },
    });

    res.status(201).json(application);
  } catch (error: any) {
    console.error('Error creating application:', error);
    res.status(500).json({ error: 'Failed to create application' });
  }
});

// PATCH /api/applications/:id - Update application stage, approval, notes
applicationsRouter.patch('/applications/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { stage, status, isApproved, notes, appliedUrl } = req.body;

    const existing = await prisma.jobApplication.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const updateData: any = {};
    if (stage !== undefined) updateData.stage = stage;
    if (status !== undefined) updateData.status = status;
    if (isApproved !== undefined) updateData.isApproved = Boolean(isApproved);
    if (notes !== undefined) updateData.notes = notes;
    if (appliedUrl !== undefined) updateData.appliedUrl = appliedUrl;

    if (stage === 'APPLIED' && !existing.submittedAt) {
      updateData.submittedAt = new Date();
    }

    const updated = await prisma.jobApplication.update({
      where: { id },
      data: updateData,
      include: {
        jobListing: true,
        candidateProfile: true,
        documents: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: 'JOB_APPLICATION_UPDATED',
        entityId: id,
        metadata: { changes: updateData },
      },
    });

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update application' });
  }
});

// POST /api/applications/:id/submit - Human-in-the-loop approved submit gate
applicationsRouter.post('/applications/:id/submit', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const application = await prisma.jobApplication.findUnique({ where: { id } });
    if (!application) return res.status(404).json({ error: 'Not found' });

    if (!application.isApproved) {
      return res.status(403).json({ error: 'Application cannot be submitted without explicit approval' });
    }

    const updated = await prisma.jobApplication.update({
      where: { id },
      data: {
        status: 'SUBMITTED',
        stage: 'APPLIED',
        submittedAt: new Date(),
      },
      include: {
        jobListing: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: 'APPLICATION_SUBMITTED_WITH_HUMAN_APPROVAL',
        entityId: id,
        metadata: { company: updated.jobListing.company, title: updated.jobListing.title },
      },
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit application' });
  }
});

// DELETE /api/applications/:id - Delete an application
applicationsRouter.delete('/applications/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.jobApplication.findUnique({ where: { id } });

    if (!existing) {
      return res.status(404).json({ error: 'Application not found' });
    }

    await prisma.jobApplication.delete({ where: { id } });

    await prisma.auditLog.create({
      data: {
        action: 'JOB_APPLICATION_DELETED',
        entityId: id,
      },
    });

    res.json({ success: true, message: 'Application deleted' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete application' });
  }
});
