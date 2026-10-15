import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { syncService, connectorLabel } from '../jobs/syncService';
import {
  createConnector,
  normalizeSourceType,
  isSupportedSourceType,
  validateSourceToken,
  SUPPORTED_SOURCE_TYPES,
  UNSUPPORTED_SOURCE_TYPES,
} from '../connectors/registry';
import { rescoreAllJobs } from '../matching/resumeScoring';

const router = Router();

// GET /api/sources/types - Source types the add-form can offer
router.get('/types', (_req: Request, res: Response) => {
  res.json({ types: SUPPORTED_SOURCE_TYPES, unsupported: UNSUPPORTED_SOURCE_TYPES });
});

// GET /api/sources - List configured sources with their latest sync run
router.get('/', async (_req: Request, res: Response) => {
  try {
    await syncService.ensureDefaultSources();
    const sources = await prisma.jobSourceConfig.findMany({ orderBy: { createdAt: 'asc' } });

    const labels = new Map<string, string>();
    for (const s of sources) {
      const connector = createConnector(s);
      if (connector) labels.set(s.id, connectorLabel(connector));
    }
    const runs = labels.size
      ? await prisma.syncRun.findMany({
          where: { source: { in: [...new Set(labels.values())] } },
          orderBy: { startedAt: 'desc' },
          take: 500,
        })
      : [];
    const latest = new Map<string, (typeof runs)[number]>();
    for (const run of runs) if (!latest.has(run.source)) latest.set(run.source, run);

    res.json({
      sources: sources.map((s) => {
        const run = labels.has(s.id) ? latest.get(labels.get(s.id)!) : undefined;
        return {
          ...s,
          supported: isSupportedSourceType(s.sourceType),
          unsupportedReason: UNSUPPORTED_SOURCE_TYPES[s.sourceType.toLowerCase()] || null,
          lastRun: run
            ? {
                status: run.status,
                startedAt: run.startedAt,
                completedAt: run.completedAt,
                fetchedCount: run.fetchedCount,
                newCount: run.newCount,
                errorMessage: run.errorMessage,
              }
            : null,
        };
      }),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to list job sources' });
  }
});

// POST /api/sources - Add (or rename/re-enable) a source
router.post('/', async (req: Request, res: Response) => {
  try {
    const { sourceType: rawType, boardToken, name, enabled } = req.body;

    if (!rawType || !name) {
      return res.status(400).json({ error: 'sourceType and name are required' });
    }

    const sourceType = normalizeSourceType(String(rawType));
    if (!isSupportedSourceType(sourceType)) {
      const reason = UNSUPPORTED_SOURCE_TYPES[sourceType];
      return res.status(400).json({
        error: reason
          ? `Source type '${rawType}' is not supported: ${reason}`
          : `Invalid sourceType '${rawType}'. Allowed types: ${SUPPORTED_SOURCE_TYPES.map((t) => t.type).join(', ')}`,
      });
    }

    // Tokens keep their case: SmartRecruiters ids and feed URLs are case-sensitive.
    const token = String(boardToken || '').trim() || (['remotive'].includes(sourceType) ? 'software-dev' : sourceType === 'remoteok' ? 'dev' : sourceType === 'arbeitnow' ? 'global' : '');
    const invalid = validateSourceToken(sourceType, token);
    if (invalid) return res.status(400).json({ error: invalid });

    const source = await prisma.jobSourceConfig.upsert({
      where: { sourceType_boardToken: { sourceType, boardToken: token } },
      update: { name, enabled: enabled ?? true },
      create: { sourceType, boardToken: token, name, enabled: enabled ?? true },
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

// PATCH /api/sources/:id - Toggle enabled or rename
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { enabled, name } = req.body;

    const existing = await prisma.jobSourceConfig.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Job source not found' });
    }
    if (enabled && !isSupportedSourceType(existing.sourceType)) {
      return res.status(400).json({
        error: UNSUPPORTED_SOURCE_TYPES[existing.sourceType.toLowerCase()] || `Unsupported source type ${existing.sourceType}`,
      });
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

// DELETE /api/sources/:id
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

// POST /api/sources/:id/sync - Sync one source (records a SUCCESS or FAILED SyncRun)
router.post('/:id/sync', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const config = await prisma.jobSourceConfig.findUnique({ where: { id } });

    if (!config) {
      return res.status(404).json({ error: 'Job source not found' });
    }

    const connector = createConnector(config);
    if (!connector) {
      const reason = UNSUPPORTED_SOURCE_TYPES[config.sourceType.toLowerCase()];
      return res.status(400).json({ error: reason || `Unsupported connector type: ${config.sourceType}` });
    }

    const startTime = Date.now();
    const ctx = await syncService.loadScoringContext();
    const result = await syncService.syncConnector({ connector, config }, ctx);
    const durationMs = Date.now() - startTime;
    const updatedSource = await prisma.jobSourceConfig.findUnique({ where: { id } });

    if (result.status === 'FAILED') {
      return res.status(502).json({ error: result.error || 'Sync failed', source: updatedSource, durationMs });
    }
    if (result.status === 'SUCCESS') {
      rescoreAllJobs().catch(() => {});
    }

    res.json({
      success: true,
      skipped: result.status === 'SKIPPED',
      message: result.error,
      source: updatedSource,
      fetched: result.fetched,
      new: result.new,
      updated: result.updated,
      closed: result.closed ?? 0,
      durationMs,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to sync source' });
  }
});

export default router;
