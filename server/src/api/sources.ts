import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { syncService, SyncService } from '../jobs/syncService';
import { processAndUpsertJob } from '../jobs/normalization';
import { RawJobPayload } from '../connectors/types';

const router = Router();

// GET /api/sources - List all configured job sources
router.get('/', async (_req: Request, res: Response) => {
  try {
    await syncService.ensureDefaultSources();
    const sources = await prisma.jobSourceConfig.findMany({
      orderBy: { createdAt: 'asc' },
    });
    res.json({ sources });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to list job sources' });
  }
});

// POST /api/sources - Add a new job source
router.post('/', async (req: Request, res: Response) => {
  try {
    const { sourceType, boardToken, name, enabled } = req.body;

    if (!sourceType || !name) {
      return res.status(400).json({ error: 'sourceType and name are required' });
    }

    const validTypes = ['greenhouse', 'ashby', 'lever', 'arbeitnow', 'linkedin', 'wellfound'];
    if (!validTypes.includes(sourceType.toLowerCase())) {
      return res.status(400).json({
        error: `Invalid sourceType '${sourceType}'. Allowed types: ${validTypes.join(', ')}`,
      });
    }

    const token = (boardToken || '').trim().toLowerCase();
    const source = await prisma.jobSourceConfig.upsert({
      where: {
        sourceType_boardToken: {
          sourceType: sourceType.toLowerCase(),
          boardToken: token,
        },
      },
      update: {
        name,
        enabled: enabled ?? true,
      },
      create: {
        sourceType: sourceType.toLowerCase(),
        boardToken: token,
        name,
        enabled: enabled ?? true,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: 'JOB_SOURCE_CONFIGURED',
        entityId: source.id,
        metadata: { sourceType, boardToken: token, name },
      },
    });

    res.status(201).json({ source });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create job source' });
  }
});

// PATCH /api/sources/:id - Toggle enabled or update name
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { enabled, name } = req.body;

    const existing = await prisma.jobSourceConfig.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Job source not found' });
    }

    const updated = await prisma.jobSourceConfig.update({
      where: { id },
      data: {
        ...(enabled !== undefined ? { enabled: Boolean(enabled) } : {}),
        ...(name ? { name } : {}),
      },
    });

    res.json({ source: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update job source' });
  }
});

// DELETE /api/sources/:id - Delete a job source
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.jobSourceConfig.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Job source not found' });
    }

    await prisma.jobSourceConfig.delete({ where: { id } });
    res.json({ success: true, message: `Source ${existing.name} removed` });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to delete job source' });
  }
});

// POST /api/sources/:id/sync - Sync a single job source
router.post('/:id/sync', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const config = await prisma.jobSourceConfig.findUnique({ where: { id } });

    if (!config) {
      return res.status(404).json({ error: 'Job source not found' });
    }

    const connector = SyncService.createConnector(config);
    if (!connector) {
      return res.status(400).json({ error: `Unsupported connector type: ${config.sourceType}` });
    }

    const profile = await prisma.candidateProfile.findFirst({ orderBy: { id: 'asc' } });
    const startTime = Date.now();

    const rawJobs = (await connector.fetchJobs()) as RawJobPayload[];
    let newCount = 0;
    let updatedCount = 0;

    for (const rawJob of rawJobs) {
      const { isNew } = await processAndUpsertJob(rawJob, profile);
      if (isNew) newCount++;
      else updatedCount++;
    }

    const durationMs = Date.now() - startTime;
    const updatedSource = await prisma.jobSourceConfig.update({
      where: { id: config.id },
      data: {
        lastSyncedAt: new Date(),
        jobCount: newCount + updatedCount,
      },
    });

    await prisma.syncRun.create({
      data: {
        source: config.name,
        status: 'SUCCESS',
        fetchedCount: rawJobs.length,
        newCount,
        updatedCount,
        durationMs,
        completedAt: new Date(),
      },
    });

    res.json({
      success: true,
      source: updatedSource,
      fetched: rawJobs.length,
      new: newCount,
      updated: updatedCount,
      durationMs,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to sync source' });
  }
});

export default router;
