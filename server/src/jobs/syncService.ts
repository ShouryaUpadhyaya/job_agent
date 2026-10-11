import { prisma } from '../db';
import { JobConnector, RawJobPayload } from '../connectors/types';
import { GreenhouseConnector } from '../connectors/greenhouse';
import { AshbyConnector } from '../connectors/ashby';
import { ArbeitnowConnector } from '../connectors/arbeitnow';
import { processAndUpsertJob } from './normalization';

export interface SyncSummary {
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'ALREADY_RUNNING';
  totalFetched: number;
  totalNew: number;
  totalUpdated: number;
  connectorResults: {
    source: string;
    status: 'SUCCESS' | 'FAILED';
    fetched: number;
    new: number;
    updated: number;
    error?: string;
  }[];
  durationMs: number;
}

export class SyncService {
  private connectors: JobConnector[] = [];
  private isSyncRunning = false;

  constructor() {
    // Default active production connectors
    this.connectors = [
      new GreenhouseConnector('cloudflare', 'Cloudflare'),
      new AshbyConnector('linear', 'Linear'),
      new ArbeitnowConnector(),
    ];
  }

  registerConnector(connector: JobConnector) {
    this.connectors.push(connector);
  }

  setConnectors(connectors: JobConnector[]) {
    this.connectors = connectors;
  }

  getConnectors(): JobConnector[] {
    return [...this.connectors];
  }

  isSyncing(): boolean {
    return this.isSyncRunning;
  }

  async syncAll(options: { force?: boolean } = {}): Promise<SyncSummary> {
    if (this.isSyncRunning && !options.force) {
      return {
        status: 'ALREADY_RUNNING',
        totalFetched: 0,
        totalNew: 0,
        totalUpdated: 0,
        connectorResults: [],
        durationMs: 0,
      };
    }

    this.isSyncRunning = true;
    const startTime = Date.now();
    let totalFetched = 0;
    let totalNew = 0;
    let totalUpdated = 0;
    const connectorResults: SyncSummary['connectorResults'] = [];

    try {
      // Fetch active candidate profile for matching, or ensure default profile
      let profile = await prisma.candidateProfile.findFirst({
        orderBy: { id: 'asc' },
      });

      if (!profile) {
        profile = await prisma.candidateProfile.create({
          data: {
            name: 'Shourya Upadhyaya',
            skills: [
              'JavaScript', 'TypeScript', 'React', 'Next.js', 'Node.js', 'Express',
              'PostgreSQL', 'Prisma', 'SQL', 'REST APIs', 'WebSockets', 'Redis',
              'Docker', 'Linux', 'Git',
            ],
            education: {
              degree: 'B.Tech Computer Science and Engineering',
              institution: 'VIT Vellore',
              graduationYear: 2028,
            },
            experience: {
              target: '2027 software engineering internships',
              preferredRoles: ['Backend Engineering Intern', 'Full-Stack Engineering Intern'],
            },
          },
        });
      }

      for (const connector of this.connectors) {
        const sourceName = connector.name || (connector as any).source || 'Unknown';
        const syncRunStart = Date.now();

        const syncRun = await prisma.syncRun.create({
          data: {
            source: sourceName,
            status: 'RUNNING',
            startedAt: new Date(),
          },
        });

        try {
          const rawJobs = (await connector.fetchJobs()) as RawJobPayload[];
          let connectorNew = 0;
          let connectorUpdated = 0;

          for (const rawJob of rawJobs) {
            const { isNew } = await processAndUpsertJob(rawJob, profile);
            if (isNew) {
              connectorNew++;
            } else {
              connectorUpdated++;
            }
          }

          const durationMs = Date.now() - syncRunStart;
          await prisma.syncRun.update({
            where: { id: syncRun.id },
            data: {
              status: 'SUCCESS',
              fetchedCount: rawJobs.length,
              newCount: connectorNew,
              updatedCount: connectorUpdated,
              completedAt: new Date(),
              durationMs,
            },
          });

          totalFetched += rawJobs.length;
          totalNew += connectorNew;
          totalUpdated += connectorUpdated;

          connectorResults.push({
            source: sourceName,
            status: 'SUCCESS',
            fetched: rawJobs.length,
            new: connectorNew,
            updated: connectorUpdated,
          });
        } catch (err: any) {
          const durationMs = Date.now() - syncRunStart;
          const errorMessage = err?.message || String(err);

          await prisma.syncRun.update({
            where: { id: syncRun.id },
            data: {
              status: 'FAILED',
              errorMessage,
              completedAt: new Date(),
              durationMs,
            },
          });

          console.error(`[SyncService] Connector failed: ${sourceName}:`, errorMessage);

          connectorResults.push({
            source: sourceName,
            status: 'FAILED',
            fetched: 0,
            new: 0,
            updated: 0,
            error: errorMessage,
          });
        }
      }

      // Record audit log
      await prisma.auditLog.create({
        data: {
          action: 'JOB_SYNC_EXECUTED',
          entityId: 'SYSTEM',
          metadata: {
            totalFetched,
            totalNew,
            totalUpdated,
            results: connectorResults,
          },
        },
      });

      const failedCount = connectorResults.filter((r) => r.status === 'FAILED').length;
      let overallStatus: SyncSummary['status'] = 'SUCCESS';
      if (failedCount === connectorResults.length && connectorResults.length > 0) {
        overallStatus = 'FAILED';
      } else if (failedCount > 0) {
        overallStatus = 'PARTIAL';
      }

      return {
        status: overallStatus,
        totalFetched,
        totalNew,
        totalUpdated,
        connectorResults,
        durationMs: Date.now() - startTime,
      };
    } finally {
      this.isSyncRunning = false;
    }
  }

  async getSyncStatus() {
    const recentRuns = await prisma.syncRun.findMany({
      take: 10,
      orderBy: { startedAt: 'desc' },
    });

    const totalJobs = await prisma.jobListing.count();
    const lastSuccessRun = await prisma.syncRun.findFirst({
      where: { status: 'SUCCESS' },
      orderBy: { completedAt: 'desc' },
    });

    return {
      isSyncing: this.isSyncRunning,
      totalJobs,
      lastSyncAt: lastSuccessRun?.completedAt || null,
      activeConnectors: this.connectors.map((c) => ({
        name: c.name || (c as any).source || 'Connector',
        source: (c as any).source || 'Generic',
      })),
      recentRuns,
    };
  }
}

export const syncService = new SyncService();
