import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { companyKey } from '../lib/company';
import { ensureActiveProfile } from '../lib/profile';
import { STAGES, Stage, isStage, statusForStage } from '../lib/stages';
import {
  APPLICATION_SOURCES,
  applicationStats,
  getApplicationDto,
  listApplications,
} from '../applications/service';
import { recordApplicationCreated, recordApplicationUpdate } from '../applications/audit';

export const applicationsRouter = Router();

const NOTES_MAX = 5000;

function cleanNotes(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).slice(0, NOTES_MAX);
  return s.trim() ? s : null;
}

/**
 * GET /api/applications — pipeline list.
 * Query: stage (csv), status (csv), source (csv), q (title/company/notes), hasAlumni=true,
 * sort = fit (default) | match | alumni | recent | applied | company.
 */
applicationsRouter.get('/applications', async (req: Request, res: Response) => {
  try {
    res.json(await listApplications(req.query));
  } catch (error) {
    console.error('Error fetching applications:', error);
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

/** GET /api/applications/stats — counts per stage and source. */
applicationsRouter.get('/applications/stats', async (_req: Request, res: Response) => {
  try {
    res.json(await applicationStats());
  } catch (error) {
    console.error('Error fetching application stats:', error);
    res.status(500).json({ error: 'Failed to fetch application stats' });
  }
});

applicationsRouter.get('/applications/:id', async (req: Request, res: Response) => {
  try {
    const dto = await getApplicationDto(String(req.params.id));
    if (!dto) return res.status(404).json({ error: 'Application not found' });
    const documents = await prisma.document.findMany({
      where: { jobApplicationId: dto.id },
      select: { id: true, type: true, version: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ...dto, documents });
  } catch (error) {
    console.error('Error fetching application:', error);
    res.status(500).json({ error: 'Failed to fetch application' });
  }
});

/**
 * POST /api/applications — track a job. Idempotent per (job, profile): saving the same job
 * twice returns the existing application with `duplicate: true` (200) instead of a copy.
 */
applicationsRouter.post('/applications', async (req: Request, res: Response) => {
  try {
    const { jobListingId, candidateProfileId, stage, notes, isApproved, source } = req.body ?? {};

    if (!jobListingId || typeof jobListingId !== 'string') {
      return res.status(400).json({ error: 'Missing required field: jobListingId' });
    }
    if (stage !== undefined && !isStage(stage)) {
      return res.status(400).json({ error: `Invalid stage. Use one of: ${STAGES.join(', ')}` });
    }
    if (source !== undefined && !(APPLICATION_SOURCES as readonly string[]).includes(source)) {
      return res.status(400).json({ error: `Invalid source. Use one of: ${APPLICATION_SOURCES.join(', ')}` });
    }

    const job = await prisma.jobListing.findUnique({ where: { id: jobListingId }, select: { id: true, company: true } });
    if (!job) return res.status(404).json({ error: 'Job listing not found' });

    let profileId: string;
    if (candidateProfileId) {
      const profile = await prisma.candidateProfile.findUnique({ where: { id: String(candidateProfileId) }, select: { id: true } });
      if (!profile) return res.status(400).json({ error: 'Candidate profile not found' });
      profileId = profile.id;
    } else {
      profileId = (await ensureActiveProfile()).id;
    }

    const existing = await prisma.jobApplication.findFirst({
      where: { jobListingId, candidateProfileId: profileId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (existing) {
      const dto = await getApplicationDto(existing.id);
      return res.status(200).json({ ...dto, duplicate: true });
    }

    const finalStage: Stage = stage ?? 'BOOKMARKED';
    const created = await prisma.jobApplication.create({
      data: {
        jobListingId,
        candidateProfileId: profileId,
        stage: finalStage,
        status: statusForStage(finalStage),
        notes: cleanNotes(notes),
        isApproved: Boolean(isApproved),
        source: source ?? 'manual',
        companyKey: companyKey(job.company),
        submittedAt: finalStage === 'APPLIED' ? new Date() : null,
      },
      select: { id: true, stage: true },
    });

    await recordApplicationCreated({
      applicationId: created.id,
      jobListingId,
      stage: created.stage,
      source: source ?? 'manual',
    });

    const dto = await getApplicationDto(created.id);
    res.status(201).json({ ...dto, duplicate: false });
  } catch (error) {
    console.error('Error creating application:', error);
    res.status(500).json({ error: 'Failed to create application' });
  }
});

/**
 * PATCH /api/applications/:id — manual edits from the UI (stage, notes, approval, appliedUrl).
 * The stage is validated and `status` is always derived from it; moving to APPLIED stamps
 * `submittedAt` once.
 */
applicationsRouter.patch('/applications/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { stage, status, isApproved, notes, appliedUrl } = req.body ?? {};

    if (stage !== undefined && !isStage(stage)) {
      return res.status(400).json({ error: `Invalid stage. Use one of: ${STAGES.join(', ')}` });
    }
    if (status !== undefined && stage === undefined) {
      return res.status(400).json({ error: 'status is derived from stage; send stage instead' });
    }

    const existing = await prisma.jobApplication.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const updateData: Record<string, unknown> = {};
    if (stage !== undefined) {
      updateData.stage = stage;
      updateData.status = statusForStage(stage);
      if (stage === 'APPLIED' && !existing.submittedAt) updateData.submittedAt = new Date();
    }
    if (isApproved !== undefined) updateData.isApproved = Boolean(isApproved);
    if (notes !== undefined) updateData.notes = cleanNotes(notes);
    if (appliedUrl !== undefined) updateData.appliedUrl = appliedUrl ? String(appliedUrl).slice(0, 2000) : null;

    if (Object.keys(updateData).length) {
      await prisma.jobApplication.update({ where: { id }, data: updateData });
      await recordApplicationUpdate({ applicationId: id, changes: updateData, fromStage: existing.stage, source: 'manual' });
    }

    res.json(await getApplicationDto(id));
  } catch (error) {
    console.error('Error updating application:', error);
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
        status: statusForStage('APPLIED'),
        stage: 'APPLIED',
        submittedAt: application.submittedAt ?? new Date(),
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

    // Detach rows that reference the application so the delete cannot fail on FKs.
    await prisma.$transaction([
      prisma.document.updateMany({ where: { jobApplicationId: id }, data: { jobApplicationId: null } }),
      prisma.emailEvent.updateMany({ where: { jobApplicationId: id }, data: { jobApplicationId: null } }),
      prisma.jobApplication.delete({ where: { id } }),
    ]);

    await prisma.auditLog.create({
      data: {
        action: 'JOB_APPLICATION_DELETED',
        entityId: id,
      },
    });

    res.json({ success: true, message: 'Application deleted' });
  } catch (error) {
    console.error('Error deleting application:', error);
    res.status(500).json({ error: 'Failed to delete application' });
  }
});
