import { JobListing, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { FEED_TAG_PREFIX } from '../connectors/types';
import { DEFAULT_HEADERS, isRestrictedHost } from '../connectors/utils';
import { GreenhouseConnector } from '../connectors/greenhouse';
import { LeverConnector } from '../connectors/lever';
import { AshbyConnector } from '../connectors/ashby';
import { SmartRecruitersConnector } from '../connectors/smartrecruiters';

/** A feed-sourced listing missing from this many consecutive successful syncs is closed. */
export const MISSED_SYNCS_TO_CLOSE = 2;

const DAY_MS = 86_400_000;

/** Feeds whose absence from a sync means nothing (one-off sources). */
function isEphemeralFeed(feedKey: string): boolean {
  return feedKey.startsWith('email:') || feedKey.startsWith('manual') || feedKey.startsWith('import');
}

/**
 * (a) Feed liveness. Call after a successful sync of `feedKey` that started at `syncStartedAt`:
 * every active listing of that feed not upserted during the sync (lastSeenAt older than the
 * start) gets missedSyncs+1; at MISSED_SYNCS_TO_CLOSE it is closed. Upserting a listing again
 * (normalization.ts) resets missedSyncs and reactivates it.
 */
export async function recordFeedSync(
  feedKey: string | undefined,
  syncStartedAt: Date,
  fetchedCount: number
): Promise<{ missed: number; closed: number }> {
  if (!feedKey || isEphemeralFeed(feedKey)) return { missed: 0, closed: 0 };
  // An empty response is more often an API hiccup than every job closing at once.
  if (fetchedCount === 0) return { missed: 0, closed: 0 };

  const feedTag = `${FEED_TAG_PREFIX}${feedKey}`;
  const missed = await prisma.jobListing.updateMany({
    where: { isActive: true, tags: { has: feedTag }, lastSeenAt: { lt: syncStartedAt } },
    data: { missedSyncs: { increment: 1 } },
  });
  const closed = await prisma.jobListing.updateMany({
    where: { isActive: true, tags: { has: feedTag }, missedSyncs: { gte: MISSED_SYNCS_TO_CLOSE } },
    data: { isActive: false, closedAt: new Date(), closedReason: 'not_in_feed' },
  });
  return { missed: missed.count, closed: closed.count };
}

/** Patterns on a job page that mean the posting is closed. */
const CLOSED_PAGE_RE =
  /(no longer accepting applications|no longer (open|available|active)|job (is )?(not found|closed|expired)|position (has been|is) (filled|closed)|this (job|position|posting|role) (has )?(expired|been (closed|filled|removed))|posting (is )?closed|page (you('re| are) looking for )?(could not be|can't be|cannot be) found)/i;

export function pageLooksClosed(html: string): boolean {
  // Only the visible-ish part; avoid matching inside large inline scripts.
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  return CLOSED_PAGE_RE.test(text);
}

function feedOf(job: Pick<JobListing, 'tags'>): { type: string; token: string } | null {
  const tag = (job.tags || []).find((t) => t.startsWith(FEED_TAG_PREFIX));
  if (!tag) return null;
  const rest = tag.slice(FEED_TAG_PREFIX.length);
  const i = rest.indexOf(':');
  return i < 0 ? null : { type: rest.slice(0, i), token: rest.slice(i + 1) };
}

export type LivenessVerdict = 'alive' | 'closed' | 'unknown' | 'skipped';

export interface CheckDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function timedFetch(url: string, deps: CheckDeps, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 10_000);
  try {
    return await (deps.fetchImpl ?? fetch)(url, { redirect: 'follow', ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Ashby/Workable have no per-job endpoint: fetch each board once per run and cache the ids. */
type BoardCache = Map<string, Promise<Set<string> | null>>;

async function boardIds(type: string, token: string, deps: CheckDeps, cache: BoardCache): Promise<Set<string> | null> {
  const key = `${type}:${token}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      (async () => {
        const url =
          type === 'ashby'
            ? AshbyConnector.boardUrl(token)
            : `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(token)}`;
        const res = await timedFetch(url, deps, { headers: DEFAULT_HEADERS });
        if (!res.ok) return null;
        const data: any = await res.json();
        const jobs: any[] = Array.isArray(data?.jobs) ? data.jobs : [];
        return new Set(jobs.map((j) => String(type === 'ashby' ? j.id : j.shortcode)));
      })().catch(() => null)
    );
  }
  return cache.get(key)!;
}

/** Decides whether one listing is still open, using the ATS API where one exists. */
export async function checkListing(
  job: Pick<JobListing, 'externalId' | 'source' | 'url' | 'tags'>,
  deps: CheckDeps = {},
  cache: BoardCache = new Map()
): Promise<{ verdict: LivenessVerdict; reason?: string }> {
  if (isRestrictedHost(job.url)) return { verdict: 'skipped', reason: 'restricted_host' };
  const feed = feedOf(job);

  try {
    if (feed?.type === 'greenhouse' || feed?.type === 'lever' || feed?.type === 'smartrecruiters') {
      const url =
        feed.type === 'greenhouse'
          ? GreenhouseConnector.jobApiUrl(feed.token, job.externalId)
          : feed.type === 'lever'
          ? LeverConnector.postingUrl(feed.token, job.externalId)
          : SmartRecruitersConnector.postingUrl(feed.token, job.externalId);
      const res = await timedFetch(url, deps, { headers: DEFAULT_HEADERS });
      if (res.status === 404 || res.status === 410) return { verdict: 'closed', reason: `ats_${res.status}` };
      if (!res.ok) return { verdict: 'unknown', reason: `http_${res.status}` };
      if (feed.type === 'smartrecruiters') {
        const body: any = await res.json().catch(() => ({}));
        if (body?.active === false) return { verdict: 'closed', reason: 'ats_inactive' };
      }
      return { verdict: 'alive' };
    }

    if (feed?.type === 'ashby' || feed?.type === 'workable') {
      const ids = await boardIds(feed.type, feed.token, deps, cache);
      if (!ids) return { verdict: 'unknown', reason: 'board_unavailable' };
      return ids.has(job.externalId) ? { verdict: 'alive' } : { verdict: 'closed', reason: 'not_on_board' };
    }

    const res = await timedFetch(job.url, deps, {
      headers: { 'User-Agent': DEFAULT_HEADERS['User-Agent'], Accept: 'text/html,application/xhtml+xml' },
    });
    if (res.status === 404 || res.status === 410) return { verdict: 'closed', reason: `http_${res.status}` };
    if (!res.ok) return { verdict: 'unknown', reason: `http_${res.status}` };
    const finalUrl = res.url || job.url;
    if (finalUrl && isRestrictedHost(finalUrl)) return { verdict: 'unknown', reason: 'redirected_to_restricted_host' };
    const body = (await res.text()).slice(0, 300_000);
    return pageLooksClosed(body) ? { verdict: 'closed', reason: 'closed_page' } : { verdict: 'alive' };
  } catch (err: any) {
    return { verdict: 'unknown', reason: err?.name === 'AbortError' ? 'timeout' : 'network_error' };
  }
}

const RESTRICTED_URL_FILTER: Prisma.JobListingWhereInput[] = [
  { url: { contains: 'linkedin.com' } },
  { url: { contains: 'lnkd.in' } },
  { url: { contains: 'naukri.com' } },
];

export interface StaleCheckOptions extends CheckDeps {
  limit?: number;
  olderThanDays?: number;
  recheckAfterHours?: number;
  /** Pause between requests (politeness). */
  delayMs?: number;
  now?: Date;
}

/**
 * (b) Throttled liveness checks for active listings older than `olderThanDays` that were not
 * checked in the last `recheckAfterHours`. LinkedIn/Naukri URLs are never fetched; the API
 * marks them unverified instead.
 */
export async function checkStaleListings(options: StaleCheckOptions = {}) {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 40;
  const cutoff = new Date(now.getTime() - (options.olderThanDays ?? 7) * DAY_MS);
  const recheckCutoff = new Date(now.getTime() - (options.recheckAfterHours ?? 24) * 3_600_000);
  const delayMs = options.delayMs ?? 1000;

  const candidates = await prisma.jobListing.findMany({
    where: {
      isActive: true,
      AND: [
        { OR: [{ publishedAt: { lt: cutoff } }, { publishedAt: null, createdAt: { lt: cutoff } }] },
        { OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: recheckCutoff } }] },
        { NOT: { OR: RESTRICTED_URL_FILTER } },
      ],
    },
    orderBy: [{ lastCheckedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
    take: limit,
    select: { id: true, externalId: true, source: true, url: true, tags: true },
  });

  const cache: BoardCache = new Map();
  const summary = { checked: 0, closed: 0, alive: 0, unknown: 0, skipped: 0, closedIds: [] as string[] };

  for (const [i, job] of candidates.entries()) {
    if (i > 0 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    const { verdict, reason } = await checkListing(job, options, cache);
    summary.checked++;
    summary[verdict]++;
    await prisma.jobListing.update({
      where: { id: job.id },
      data:
        verdict === 'closed'
          ? { lastCheckedAt: now, isActive: false, closedAt: now, closedReason: reason || 'closed' }
          : { lastCheckedAt: now },
    });
    if (verdict === 'closed') summary.closedIds.push(job.id);
  }
  return summary;
}

export interface Verification {
  /** True when the listing was recently confirmed live (seen in its feed or checked). */
  verified: boolean;
  ageDays: number | null;
  label: string;
}

/** Computed freshness/verification info returned by the jobs API. */
export function listingVerification(
  job: Pick<JobListing, 'url' | 'source' | 'isActive' | 'lastSeenAt' | 'lastCheckedAt' | 'publishedAt' | 'createdAt' | 'tags'>,
  now: Date = new Date()
): Verification {
  const posted = job.publishedAt ?? job.createdAt;
  const ageDays = posted ? Math.floor((now.getTime() - new Date(posted).getTime()) / DAY_MS) : null;
  if (!job.isActive) return { verified: false, ageDays, label: 'Closed' };

  const restricted = isRestrictedHost(job.url);
  const hasFeed = (job.tags || []).some((t) => t.startsWith(FEED_TAG_PREFIX));
  const seenRecently = hasFeed && job.lastSeenAt && now.getTime() - new Date(job.lastSeenAt).getTime() < 3 * DAY_MS;
  const checkedRecently = job.lastCheckedAt && now.getTime() - new Date(job.lastCheckedAt).getTime() < 7 * DAY_MS;

  if (seenRecently) return { verified: true, ageDays, label: 'Live in source feed' };
  if (checkedRecently && !restricted) return { verified: true, ageDays, label: 'Checked recently' };
  if (restricted) {
    return {
      verified: false,
      ageDays,
      label: ageDays !== null && ageDays > 7 ? `Unverified, older than ${ageDays} days` : 'Unverified (open the link to confirm)',
    };
  }
  return { verified: false, ageDays, label: 'Not checked yet' };
}
