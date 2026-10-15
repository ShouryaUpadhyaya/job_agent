export interface JobListing {
  id: string;
  title: string;
  company: string;
  location?: string;
  url: string;
  description?: string;
  publishedAt?: Date;
  source?: string;
  externalId?: string;
  tags?: string[];
  score?: number;
  status?: string;
}

export interface RawJobPayload {
  externalId: string;
  source: string;
  title: string;
  company: string;
  url: string;
  description: string;
  location?: string;
  publishedAt?: Date;
  tags?: string[];
  employmentType?: string;
}

export interface JobConnector {
  readonly name?: string;
  readonly source?: string;
  /**
   * Identifies the feed this connector reads (e.g. "greenhouse:stripe"). Every listing it
   * returns is tagged `feed:<feedKey>` so liveness can tell which listings vanished from it.
   */
  readonly feedKey?: string;
  /** Minimum time between fetches, for APIs whose terms ask for infrequent polling. */
  readonly minIntervalMs?: number;
  fetchJobs(): Promise<JobListing[] | RawJobPayload[]>;
}

/** Canonical (lowercase) `JobListing.source` values written by this codebase. */
export const SOURCE_IDS = {
  greenhouse: 'greenhouse',
  ashby: 'ashby',
  lever: 'lever',
  arbeitnow: 'arbeitnow',
  smartrecruiters: 'smartrecruiters',
  workable: 'workable',
  remotive: 'remotive',
  remoteok: 'remoteok',
  rss: 'rss',
  jsonApi: 'jsonapi',
  wellfound: 'wellfound',
  linkedin: 'linkedin',
  manual: 'manual',
} as const;

/**
 * Older rows were written with capitalised source names. When a listing is seen again its
 * row is migrated to the canonical id (see normalization.ts), so filters treat both alike.
 */
export const LEGACY_SOURCE_NAMES: Record<string, string[]> = {
  greenhouse: ['Greenhouse'],
  ashby: ['Ashby'],
  lever: ['Lever'],
  arbeitnow: ['Arbeitnow'],
};

export const FEED_TAG_PREFIX = 'feed:';
