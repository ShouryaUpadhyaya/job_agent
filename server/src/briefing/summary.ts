/**
 * Daily briefing persistence. One DailyJobSearchSummary row per IST day (summaryDate is the IST
 * date as UTC midnight); content holds the rendered markdown plus the structured data.
 */
import { DailyJobSearchSummary } from '@prisma/client';
import { prisma } from '../db';
import { APP_TIMEZONE, istDateKey, istDayAsUtcMidnight, istStartOfDay } from '../lib/time';
import { BuildOptions, buildBriefing } from './build';
import { parseStoredContent, renderMarkdown, toStoredContent } from './render';
import { Briefing, BriefingMetrics, BriefingTrigger } from './types';

export type { Briefing, BriefingMetrics } from './types';

export const BRIEFING_HOUR_IST = 20;
export const HISTORY_DEFAULT = 14;
export const HISTORY_MAX = 60;

export interface BriefingResponse extends BriefingMetrics {
  id: string | null;
  /** IST calendar date, "YYYY-MM-DD". */
  date: string;
  /** Same as `date` (kept for older clients that read summaryDate). */
  summaryDate: string;
  timezone: string;
  deliveryStatus: string;
  generatedAt: string;
  /** Rendered markdown (without the embedded data block). */
  content: string;
  /** Structured briefing; null for rows stored before the structured format. */
  briefing: Briefing | null;
  persisted: boolean;
}

/** The instant 20:00 IST falls on the IST day containing `now`. */
export function briefingTimeFor(now: Date, hour = BRIEFING_HOUR_IST): Date {
  return new Date(istStartOfDay(now).getTime() + hour * 60 * 60 * 1000);
}

/**
 * Pure due-check: at/after 20:00 IST on `now`'s IST day, and the day's row (if any) was
 * generated before 20:00 that day.
 */
export function scheduledRunDue(now: Date, generatedAt: Date | null, hour = BRIEFING_HOUR_IST): boolean {
  const due = briefingTimeFor(now, hour);
  if (now.getTime() < due.getTime()) return false;
  return !generatedAt || generatedAt.getTime() < due.getTime();
}

export function toResponse(row: DailyJobSearchSummary): BriefingResponse {
  const { markdown, briefing } = parseStoredContent(row.content);
  const date = row.summaryDate.toISOString().slice(0, 10);
  return {
    id: row.id,
    date,
    summaryDate: date,
    timezone: row.timezone,
    deliveryStatus: row.deliveryStatus,
    generatedAt: row.generatedAt.toISOString(),
    newApplicationsCount: row.newApplicationsCount,
    interviewsCount: row.interviewsCount,
    rejectionsCount: row.rejectionsCount,
    acceptedConnectionsCount: row.acceptedConnectionsCount,
    needsAttentionCount: row.needsAttentionCount,
    content: markdown,
    briefing,
    persisted: true,
  };
}

function metricsOf(b: Briefing): BriefingMetrics {
  const c = b.counts;
  return {
    newApplicationsCount: c.newApplicationsCount,
    interviewsCount: c.interviewsCount,
    rejectionsCount: c.rejectionsCount,
    acceptedConnectionsCount: c.acceptedConnectionsCount,
    needsAttentionCount: c.needsAttentionCount,
  };
}

export class DailyBriefingService {
  /** Concurrent generations for the same day share one promise (scheduler vs. first page view). */
  private inflight = new Map<string, Promise<DailyJobSearchSummary>>();

  /** Builds and upserts the briefing for the IST day containing `now`. */
  async generate(now: Date = new Date(), trigger: BriefingTrigger = 'manual'): Promise<BriefingResponse> {
    const key = istDateKey(now);
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.persist(now, trigger).finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    return toResponse(await pending);
  }

  private async persist(now: Date, trigger: BriefingTrigger): Promise<DailyJobSearchSummary> {
    const briefing = await buildBriefing(now, { trigger, useAi: true });
    const summaryDate = istDayAsUtcMidnight(now);
    const data = { content: toStoredContent(briefing), ...metricsOf(briefing), generatedAt: now };
    try {
      return await prisma.dailyJobSearchSummary.upsert({
        where: { summaryDate },
        update: data,
        create: { summaryDate, timezone: APP_TIMEZONE, deliveryStatus: 'GENERATED', ...data },
      });
    } catch (err: any) {
      // Another process created the row between upsert's read and insert.
      if (err?.code === 'P2002') return prisma.dailyJobSearchSummary.update({ where: { summaryDate }, data });
      throw err;
    }
  }

  async findForDay(now: Date = new Date()): Promise<DailyJobSearchSummary | null> {
    return prisma.dailyJobSearchSummary.findUnique({ where: { summaryDate: istDayAsUtcMidnight(now) } });
  }

  /** Today's (IST) briefing; generated on demand when missing. */
  async getToday(now: Date = new Date()): Promise<BriefingResponse> {
    const row = await this.findForDay(now);
    return row ? toResponse(row) : this.generate(now, 'on-demand');
  }

  /** A fresh, unsaved build for the live view (no Gemini call). */
  async live(now: Date = new Date(), opts: BuildOptions = {}): Promise<BriefingResponse> {
    const briefing = await buildBriefing(now, { trigger: 'live', useAi: false, ...opts });
    return {
      id: null,
      date: briefing.date,
      summaryDate: briefing.date,
      timezone: APP_TIMEZONE,
      deliveryStatus: 'LIVE',
      generatedAt: briefing.generatedAt,
      ...metricsOf(briefing),
      content: renderMarkdown(briefing),
      briefing,
      persisted: false,
    };
  }

  async getHistory(limit: number = HISTORY_DEFAULT): Promise<BriefingResponse[]> {
    const take = Math.min(Math.max(1, Math.floor(limit) || HISTORY_DEFAULT), HISTORY_MAX);
    const rows = await prisma.dailyJobSearchSummary.findMany({ orderBy: { summaryDate: 'desc' }, take });
    return rows.map(toResponse);
  }

  /**
   * Whether the scheduled briefing for `now`'s IST day still has to run: it's 20:00 IST or later
   * and there is no row generated at/after 20:00 that day (a row from an earlier on-demand view
   * is replaced by the evening one).
   */
  async isScheduledRunDue(now: Date = new Date(), hour = BRIEFING_HOUR_IST): Promise<boolean> {
    if (now.getTime() < briefingTimeFor(now, hour).getTime()) return false;
    const row = await this.findForDay(now);
    return scheduledRunDue(now, row?.generatedAt ?? null, hour);
  }
}

export const dailyBriefingService = new DailyBriefingService();
