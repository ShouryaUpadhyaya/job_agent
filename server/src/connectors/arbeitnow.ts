import { JobConnector, RawJobPayload, SOURCE_IDS } from './types';
import { fetchWithRetry, cleanHtml, canonicalizeUrl, stableHash, DEFAULT_HEADERS } from './utils';

/** Arbeitnow public job board API (paginated, Europe-heavy). */
export class ArbeitnowConnector implements JobConnector {
  readonly name = 'Arbeitnow Jobs API';
  readonly source = SOURCE_IDS.arbeitnow;
  readonly feedKey = 'arbeitnow:global';

  constructor(
    private apiUrl: string = 'https://www.arbeitnow.com/api/job-board-api',
    private maxPages: number = 5
  ) {}

  async fetchJobs(): Promise<RawJobPayload[]> {
    const jobs: RawJobPayload[] = [];
    let nextUrl: string | null = this.apiUrl;

    for (let page = 0; nextUrl && page < this.maxPages; page++) {
      const response = await fetchWithRetry(nextUrl, { headers: DEFAULT_HEADERS });
      if (!response.ok) {
        if (page === 0) throw new Error(`Arbeitnow API error (${response.status}): ${response.statusText}`);
        break;
      }

      const data: any = await response.json();
      if (!data || !Array.isArray(data.data) || data.data.length === 0) break;

      for (const job of data.data) {
        const isRemote = Boolean(job.remote);
        const location = job.location ? `${job.location}${isRemote ? ' (Remote)' : ''}` : isRemote ? 'Remote' : 'Unspecified';
        const url = job.url || (job.slug ? `https://www.arbeitnow.com/jobs/${job.slug}` : '');
        if (!url) continue;
        jobs.push({
          externalId: String(job.slug || job.id || stableHash(url)),
          source: this.source,
          title: (job.title || '').trim(),
          company: (job.company_name || 'Unknown company').trim(),
          url: canonicalizeUrl(url),
          description: cleanHtml(job.description || ''),
          location,
          publishedAt: job.created_at ? new Date(job.created_at * 1000) : undefined,
          tags: [...(Array.isArray(job.tags) ? job.tags : []), ...(Array.isArray(job.job_types) ? job.job_types : [])],
        });
      }

      const next = data.links?.next;
      nextUrl = typeof next === 'string' && next && next !== nextUrl ? next : null;
    }

    return jobs;
  }
}
