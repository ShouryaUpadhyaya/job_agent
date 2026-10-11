import { JobConnector, RawJobPayload } from './types';
import { fetchWithRetry, cleanHtml, canonicalizeUrl } from './utils';

export class GreenhouseConnector implements JobConnector {
  readonly name: string;
  readonly source = 'Greenhouse';

  constructor(
    private boardToken: string = 'cloudflare',
    private companyName: string = 'Cloudflare',
    private baseUrl?: string
  ) {
    this.name = `Greenhouse (${companyName})`;
  }

  async fetchJobs(): Promise<RawJobPayload[]> {
    const url = this.baseUrl || `https://boards-api.greenhouse.io/v1/boards/${this.boardToken}/jobs?content=true`;
    const response = await fetchWithRetry(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'JobAgent/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Greenhouse API error (${response.status}): ${response.statusText}`);
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.jobs)) {
      return [];
    }

    return data.jobs.map((job: any): RawJobPayload => {
      const locationName = job.location?.name || (job.offices && job.offices[0]?.name) || 'Remote / Hybrid';
      const cleanDesc = cleanHtml(job.content || '');

      return {
        externalId: String(job.id),
        source: this.source,
        title: (job.title || '').trim(),
        company: job.company_name || this.companyName,
        url: canonicalizeUrl(job.absolute_url || `https://boards.greenhouse.io/${this.boardToken}/jobs/${job.id}`),
        description: cleanDesc,
        location: locationName,
        publishedAt: job.updated_at ? new Date(job.updated_at) : new Date(),
        tags: [this.companyName, 'Greenhouse'],
      };
    });
  }
}
