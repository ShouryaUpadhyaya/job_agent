import { Router } from 'express';
import { syncService } from '../jobs/syncService';

export const syncRouter = Router();

// Trigger an immediate sync run
syncRouter.post('/sync', async (req, res) => {
  try {
    const { force } = req.body || {};
    const summary = await syncService.syncAll({ force: Boolean(force) });

    if (summary.status === 'ALREADY_RUNNING') {
      return res.status(409).json({
        message: 'A job synchronization is already running in the background.',
        summary,
      });
    }

    if (summary.status === 'FAILED') {
      return res.status(502).json({
        message: 'All connectors failed during synchronization.',
        summary,
      });
    }

    return res.status(200).json({
      message: 'Synchronization completed.',
      summary,
    });
  } catch (error: any) {
    console.error('[API /sync] Unexpected sync failure:', error);
    return res.status(500).json({
      error: 'Failed to execute job sync',
      details: error?.message || String(error),
    });
  }
});

// Retrieve observability status and recent sync history
syncRouter.get('/sync/status', async (req, res) => {
  try {
    const status = await syncService.getSyncStatus();
    return res.status(200).json(status);
  } catch (error: any) {
    console.error('[API /sync/status] Failed to fetch sync status:', error);
    return res.status(500).json({
      error: 'Failed to retrieve sync status',
      details: error?.message || String(error),
    });
  }
});
