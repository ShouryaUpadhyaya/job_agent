import { app, prisma } from './app';
import { initScheduler, shutdownScheduler } from './scheduler/cron';

const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // Automatically start background ingestion scheduler
  if (process.env.NODE_ENV !== 'test' && process.env.DISABLE_SCHEDULER !== 'true') {
    initScheduler();

    // Auto-sync Wellfound applications from applications.csv on startup
    (async () => {
      try {
        const { syncWellfoundApplicationsFromCsv } = await import('./connectors/wellfoundAutoApplyService');
        const wfResult = await syncWellfoundApplicationsFromCsv();
        if (wfResult.newImported > 0 || wfResult.alreadyTracked > 0) {
          console.log(`[Startup] Wellfound sync: ${wfResult.newImported} new imported, ${wfResult.alreadyTracked} already tracked, ${wfResult.contactsCreated} networking contacts created.`);
        }
      } catch (err: any) {
        console.warn(`[Startup] Wellfound initial sync skipped: ${err.message}`);
      }
    })();
  }
});

// Graceful shutdown handling
function gracefulShutdown(signal: string) {
  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);
  shutdownScheduler();

  server.close(async () => {
    console.log('HTTP server closed.');
    await prisma.$disconnect();
    console.log('Database connection released.');
    process.exit(0);
  });

  // Force exit after 10s if hanging
  setTimeout(() => {
    console.error('Forced shutdown due to timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
