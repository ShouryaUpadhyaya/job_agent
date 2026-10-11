import { JobConnector, RawJobPayload } from './types';
import { fetchWithRetry, cleanHtml, canonicalizeUrl } from './utils';

export class AshbyConnector implements JobConnector {
  readonly name: string;
  readonly source = 'Ashby';

  constructor(
    private orgToken: string = 'linear',
    private companyName: string = 'Linear',
    private baseUrl?: string
  ) {
    this.name = `Ashby (${companyName})`;
  }

  async fetchJobs(): Promise<RawJobPayload[]> {
    const url = this.baseUrl || `https://api.ashbyhq.com/posting-api/job-board/${this.orgToken}`;
    const response = await fetchWithRetry(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'JobAgent/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Ashby API error (${response.status}): ${response.statusText}`);
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.jobs)) {
      return [];
    }

    return data.jobs.map((job: any): RawJobPayload => {
      const loc = job.location || (job.isRemote ? 'Remote' : 'On-site');
      const cleanDesc = cleanHtml(job.descriptionHtml || job.descriptionPlain || '');

      return {
        externalId: String(job.id),
        source: this.source,
        title: (job.title || '').trim(),
        company: this.companyName,
        url: canonicalizeUrl(job.jobUrl || job.applyUrl || `https://jobs.ashbyhq.com/${this.orgToken}/${job.id}`),
        description: cleanDesc,
        location: loc,
        publishedAt: job.publishedAt ? new Date(job.publishedAt) : new Date(),
        tags: [this.companyName, 'Ashby', ...(job.department ? [job.department] : [])],
      };
    });
  }
}
