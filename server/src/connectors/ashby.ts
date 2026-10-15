import { JobConnector, RawJobPayload, SOURCE_IDS } from './types';
import { fetchWithRetry, cleanHtml, canonicalizeUrl, DEFAULT_HEADERS } from './utils';

/** Public Ashby posting API: https://developers.ashbyhq.com/docs/public-job-posting-api */
export class AshbyConnector implements JobConnector {
  readonly name: string;
  readonly source = SOURCE_IDS.ashby;
  readonly feedKey: string;

  constructor(
    private orgToken: string = 'linear',
    private companyName: string = 'Linear',
    private baseUrl?: string
  ) {
    this.name = `Ashby (${companyName})`;
    this.feedKey = `ashby:${orgToken}`;
  }

  static boardUrl(orgToken: string): string {
    return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(orgToken)}`;
  }

  async fetchJobs(): Promise<RawJobPayload[]> {
    const url = this.baseUrl || AshbyConnector.boardUrl(this.orgToken);
    const response = await fetchWithRetry(url, { headers: DEFAULT_HEADERS });

    if (!response.ok) {
      throw new Error(`Ashby API error (${response.status}): ${response.statusText}`);
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.jobs)) {
      return [];
    }

    return data.jobs
      .filter((job: any) => job.isListed !== false)
      .map((job: any): RawJobPayload => {
        const secondary = Array.isArray(job.secondaryLocations)
          ? job.secondaryLocations.map((l: any) => l?.location).filter(Boolean)
          : [];
        const primary = job.location || (job.isRemote ? 'Remote' : 'Unspecified');
        const loc = [primary, ...secondary].join(' / ') + (job.isRemote && !/remote/i.test(primary) ? ' (Remote)' : '');

        return {
          externalId: String(job.id),
          source: this.source,
          title: (job.title || '').trim(),
          company: this.companyName,
          url: canonicalizeUrl(job.jobUrl || job.applyUrl || `https://jobs.ashbyhq.com/${this.orgToken}/${job.id}`),
          description: cleanHtml(job.descriptionHtml || job.descriptionPlain || ''),
          location: loc,
          publishedAt: job.publishedAt ? new Date(job.publishedAt) : undefined,
          employmentType: job.employmentType ? String(job.employmentType).toUpperCase() : undefined,
          tags: [this.companyName, 'Ashby', ...(job.department ? [job.department] : [])],
        };
      });
  }
}
