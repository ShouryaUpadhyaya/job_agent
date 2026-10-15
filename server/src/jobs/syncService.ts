import { JobSourceConfig } from '@prisma/client';
import { prisma } from '../db';
import { JobConnector, RawJobPayload, FEED_TAG_PREFIX } from '../connectors/types';
import { createConnector, DEFAULT_SOURCES, UNSUPPORTED_SOURCE_TYPES } from '../connectors/registry';
import { mapLimit } from '../connectors/utils';
import { ensureActiveProfile, getProfileResumes } from '../lib/profile';
import { rescoreAllJobs } from '../matching/resumeScoring';
import { processAndUpsertJob, ScoringProfile } from './normalization';
import { recordFeedSync } from './liveness';
import { ResumeLike } from '../matching/resumeScoring';

export interface ConnectorResult {
  source: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  fetched: number;
  new: number;
  updated: number;
  closed?: number;
  error?: string;
}

export interface SyncSummary {
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'ALREADY_RUNNING';
  totalFetched: number;
  totalNew: number;
  totalUpdated: number;
  connectorResults: ConnectorResult[];
  durationMs: number;
}

interface ActiveConnector {
  connector: JobConnector;
  config?: JobSourceConfig;
}

export function connectorLabel(connector: JobConnector): string {
  return connector.name || connector.source || 'Unknown';
}

export class SyncService {
  private connectors: JobConnector[] = [];
  private isSyncRunning = false;
  private hasCustomConnectors = false;

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

  /** Kept for callers of the old API; see connectors/registry.ts. */
  static createConnector(config: { sourceType: string; boardToken: string; name: string }): JobConnector | null {
    return createConnector(config);
  }

  /**
   * Adds curated default sources that are missing (never deletes or re-enables user rows) and
   * disables legacy LinkedIn/Wellfound connector rows, which violated those sites' terms.
   */
  async ensureDefaultSources(): Promise<void> {
    await prisma.jobSourceConfig.updateMany({
      where: { sourceType: { in: Object.keys(UNSUPPORTED_SOURCE_TYPES) }, enabled: true },
      data: { enabled: false },
    });
    const existing = await prisma.jobSourceConfig.findMany({ select: { sourceType: true, boardToken: true } });
    const have = new Set(existing.map((s) => `${s.sourceType}:${s.boardToken.toLowerCase()}`));
    const missing = DEFAULT_SOURCES.filter((d) => !have.has(`${d.sourceType}:${d.boardToken.toLowerCase()}`));
    if (missing.length) {
      await prisma.jobSourceConfig.createMany({ data: missing, skipDuplicates: true });
    }
  }

  async getActiveConnectors(): Promise<ActiveConnector[]> {
    if (this.hasCustomConnectors) {
      return this.connectors.map((c) => ({ connector: c }));
    }
    await this.ensureDefaultSources();
    const configs = await prisma.jobSourceConfig.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
    });
    const list: ActiveConnector[] = [];
    for (const config of configs) {
      const connector = createConnector(config);
      if (connector) list.push({ connector, config });
    }
    return list;
  }

  /**
   * Fetches one connector, upserts its listings, applies feed liveness and records a SyncRun
   * (SUCCESS or FAILED). Never throws for connector errors.
   */
  async syncConnector(
    item: ActiveConnector,
    ctx: { profile: ScoringProfile; resumes: ResumeLike[] }
  ): Promise<ConnectorResult> {
    const { connector, config } = item;
    const label = connectorLabel(connector);

    if (connector.minIntervalMs && config?.lastSyncedAt && Date.now() - config.lastSyncedAt.getTime() < connector.minIntervalMs) {
      return { source: label, status: 'SKIPPED', fetched: 0, new: 0, updated: 0, error: 'Polled recently (source asks for infrequent polling)' };
    }

    const startedAt = new Date();
    const syncRun = await prisma.syncRun.create({
      data: { source: label, status: 'RUNNING', startedAt },
    });

    try {
      const rawJobs = (await connector.fetchJobs()) as RawJobPayload[];
      const feedTag = connector.feedKey ? `${FEED_TAG_PREFIX}${connector.feedKey}` : null;
      let created = 0;
      let updated = 0;

      for (const rawJob of rawJobs) {
        if (!rawJob || !rawJob.externalId || !rawJob.url || !rawJob.title) continue;
        const payload = feedTag ? { ...rawJob, tags: [...(rawJob.tags || []), feedTag] } : rawJob;
        const { isNew } = await processAndUpsertJob(payload, ctx.profile, ctx.resumes);
        if (isNew) created++;
        else updated++;
      }

      const liveness = await recordFeedSync(connector.feedKey, startedAt, rawJobs.length);
      const durationMs = Date.now() - startedAt.getTime();

      await prisma.syncRun.update({
        where: { id: syncRun.id },
        data: {
          status: 'SUCCESS',
          fetchedCount: rawJobs.length,
          newCount: created,
          updatedCount: updated,
          completedAt: new Date(),
          durationMs,
        },
      });

      if (config) {
        const jobCount = feedTag
          ? await prisma.jobListing.count({ where: { isActive: true, tags: { has: feedTag } } })
          : created + updated;
        await prisma.jobSourceConfig
          .update({ where: { id: config.id }, data: { lastSyncedAt: new Date(), jobCount } })
          .catch(() => {});
      }

      return { source: label, status: 'SUCCESS', fetched: rawJobs.length, new: created, updated, closed: liveness.closed };
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      await prisma.syncRun.update({
        where: { id: syncRun.id },
        data: {
          status: 'FAILED',
          errorMessage,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt.getTime(),
        },
      });
      console.error(`[SyncService] Connector failed: ${label}:`, errorMessage);
      return { source: label, status: 'FAILED', fetched: 0, new: 0, updated: 0, error: errorMessage };
    }
  }

  async loadScoringContext(): Promise<{ profile: ScoringProfile; resumes: ResumeLike[] }> {
    const profile = await ensureActiveProfile();
    const resumes = await getProfileResumes(profile.id);
    return { profile, resumes };
  }

  async syncAll(options: { force?: boolean; concurrency?: number } = {}): Promise<SyncSummary> {
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

    try {
      const ctx = await this.loadScoringContext();
      const activeList = await this.getActiveConnectors();
      const connectorResults = await mapLimit(activeList, options.concurrency ?? 3, (item) =>
        this.syncConnector(item, ctx)
      );

      const ran = connectorResults.filter((r) => r.status !== 'SKIPPED');
      const totalFetched = ran.reduce((n, r) => n + r.fetched, 0);
      const totalNew = ran.reduce((n, r) => n + r.new, 0);
      const totalUpdated = ran.reduce((n, r) => n + r.updated, 0);

      // Freshness decays daily, so scores of listings not touched by this sync drift; refresh all.
      await rescoreAllJobs().catch((err) => console.error('[SyncService] Rescore failed:', err?.message || err));

      await prisma.auditLog.create({
        data: {
          action: 'JOB_SYNC_EXECUTED',
          entityId: 'SYSTEM',
          metadata: { totalFetched, totalNew, totalUpdated, results: connectorResults as any },
        },
      });

      const failedCount = ran.filter((r) => r.status === 'FAILED').length;
      let status: SyncSummary['status'] = 'SUCCESS';
      if (failedCount > 0 && failedCount === ran.length) status = 'FAILED';
      else if (failedCount > 0) status = 'PARTIAL';

      return {
        status,
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

    const totalJobs = await prisma.jobListing.count({ where: { isActive: true } });
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
        name: connectorLabel(item.connector),
        source: item.connector.source || 'Generic',
      })),
      recentRuns,
    };
  }
}

export const syncService = new SyncService();
