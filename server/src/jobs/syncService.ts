import { prisma } from '../db';
import { JobConnector, RawJobPayload } from '../connectors/types';
import { GreenhouseConnector } from '../connectors/greenhouse';
import { AshbyConnector } from '../connectors/ashby';
import { LeverConnector } from '../connectors/lever';
import { ArbeitnowConnector } from '../connectors/arbeitnow';
import { LinkedInConnector } from '../connectors/linkedin';
import { WellfoundConnector } from '../connectors/wellfound';
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
  private hasCustomConnectors = false;

  constructor() {
    this.connectors = [
      new GreenhouseConnector('cloudflare', 'Cloudflare'),
      new AshbyConnector('linear', 'Linear'),
      new LeverConnector('spotify', 'Spotify'),
      new ArbeitnowConnector(),
      new LinkedInConnector('Software Engineer Intern', 'India', 'LinkedIn Jobs'),
      new WellfoundConnector('Wellfound Startups'),
    ];
  }

  registerConnector(connector: JobConnector) {
    this.connectors.push(connector);
    this.hasCustomConnectors = true;
  }

  setConnectors(connectors: JobConnector[]) {
    this.connectors = connectors;
    this.hasCustomConnectors = true;
  }

  getConnectors(): JobConnector[] {
    return [...this.connectors];
  }

  isSyncing(): boolean {
    return this.isSyncRunning;
  }

  static createConnector(config: { sourceType: string; boardToken: string; name: string }): JobConnector | null {
    switch (config.sourceType.toLowerCase()) {
      case 'greenhouse':
        return new GreenhouseConnector(config.boardToken, config.name);
      case 'ashby':
        return new AshbyConnector(config.boardToken, config.name);
      case 'lever':
        return new LeverConnector(config.boardToken, config.name);
      case 'arbeitnow':
        return new ArbeitnowConnector();
      case 'linkedin':
        return new LinkedInConnector(config.boardToken || 'Software Engineer Intern', 'India', config.name || 'LinkedIn Jobs');
      case 'wellfound':
        return new WellfoundConnector(config.name || 'Wellfound Startups');
      default:
        return null;
    }
  }

  async ensureDefaultSources(): Promise<void> {
    const count = await prisma.jobSourceConfig.count();
    if (count === 0) {
      const defaultConfigs = [
        { sourceType: 'greenhouse', boardToken: 'cloudflare', name: 'Cloudflare' },
        { sourceType: 'ashby', boardToken: 'linear', name: 'Linear' },
        { sourceType: 'lever', boardToken: 'spotify', name: 'Spotify' },
        { sourceType: 'arbeitnow', boardToken: 'global', name: 'Arbeitnow Tech' },
        { sourceType: 'linkedin', boardToken: 'software-engineer-intern', name: 'LinkedIn Jobs' },
        { sourceType: 'wellfound', boardToken: 'startups', name: 'Wellfound Startups' },
      ];
      for (const cfg of defaultConfigs) {
        await prisma.jobSourceConfig.upsert({
          where: {
            sourceType_boardToken: {
              sourceType: cfg.sourceType,
              boardToken: cfg.boardToken,
            },
          },
          update: {},
          create: cfg,
        });
      }
    }
  }

  async getActiveConnectors(): Promise<{ connector: JobConnector; configId?: string }[]> {
    if (this.hasCustomConnectors) {
      return this.connectors.map((c) => ({ connector: c }));
    }

    try {
      await this.ensureDefaultSources();
      const configs = await prisma.jobSourceConfig.findMany({
        where: { enabled: true },
        orderBy: { createdAt: 'asc' },
      });

      const list: { connector: JobConnector; configId?: string }[] = [];
      for (const cfg of configs) {
        const conn = SyncService.createConnector(cfg);
        if (conn) {
          list.push({ connector: conn, configId: cfg.id });
        }
      }

      if (list.length > 0) {
        return list;
      }
    } catch {
      // Fallback to in-memory defaults if DB is temporarily unreachable
    }

    return this.connectors.map((c) => ({ connector: c }));
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

      const activeList = await this.getActiveConnectors();

      for (const item of activeList) {
        const connector = item.connector;
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

          if (item.configId) {
            await prisma.jobSourceConfig.update({
              where: { id: item.configId },
              data: {
                lastSyncedAt: new Date(),
                jobCount: connectorNew + connectorUpdated,
              },
            }).catch(() => {});
          }

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

    const activeList = await this.getActiveConnectors();

    return {
      isSyncing: this.isSyncRunning,
      totalJobs,
      lastSyncAt: lastSuccessRun?.completedAt || null,
      activeConnectors: activeList.map((item) => ({
        name: item.connector.name || (item.connector as any).source || 'Connector',
        source: (item.connector as any).source || 'Generic',
      })),
      recentRuns,
    };
  }
}

export const syncService = new SyncService();
