import { JobConnector, RawJobPayload } from './types';
import { fetchWithRetry, cleanHtml, canonicalizeUrl } from './utils';

export class ArbeitnowConnector implements JobConnector {
  readonly name = 'Arbeitnow Jobs API';
  readonly source = 'Arbeitnow';

  constructor(private apiUrl: string = 'https://www.arbeitnow.com/api/job-board-api') {}

  async fetchJobs(): Promise<RawJobPayload[]> {
    const response = await fetchWithRetry(this.apiUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'JobAgent/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Arbeitnow API error (${response.status}): ${response.statusText}`);
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.data)) {
      return [];
    }

    return data.data.map((job: any): RawJobPayload => {
      const isRemote = Boolean(job.remote);
      const location = job.location || (isRemote ? 'Remote' : 'Unspecified');
      const cleanDesc = cleanHtml(job.description || '');

      return {
        externalId: String(job.slug || job.id || Math.random().toString(36).slice(2)),
        source: this.source,
        title: (job.title || '').trim(),
        company: (job.company_name || 'Tech Company').trim(),
        url: canonicalizeUrl(job.url || `https://www.arbeitnow.com/jobs/${job.slug}`),
        description: cleanDesc,
        location,
        publishedAt: job.created_at ? new Date(job.created_at * 1000) : new Date(),
        tags: Array.isArray(job.tags) ? job.tags : ['Tech'],
      };
    });
  }
}
