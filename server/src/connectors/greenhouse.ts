import { JobConnector, RawJobPayload, SOURCE_IDS } from './types';
import { fetchWithRetry, cleanHtml, canonicalizeUrl, DEFAULT_HEADERS } from './utils';

/** Public Greenhouse Job Board API: https://developers.greenhouse.io/job-board.html */
export class GreenhouseConnector implements JobConnector {
  readonly name: string;
  readonly source = SOURCE_IDS.greenhouse;
  readonly feedKey: string;

  constructor(
    private boardToken: string = 'cloudflare',
    private companyName: string = 'Cloudflare',
    private baseUrl?: string
  ) {
    this.name = `Greenhouse (${companyName})`;
    this.feedKey = `greenhouse:${boardToken}`;
  }

  static jobApiUrl(boardToken: string, jobId: string): string {
    return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs/${encodeURIComponent(jobId)}`;
  }

  async fetchJobs(): Promise<RawJobPayload[]> {
    const url = this.baseUrl || `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(this.boardToken)}/jobs?content=true`;
    const response = await fetchWithRetry(url, { headers: DEFAULT_HEADERS });

    if (!response.ok) {
      throw new Error(`Greenhouse API error (${response.status}): ${response.statusText}`);
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.jobs)) {
      return [];
    }

    return data.jobs.map((job: any): RawJobPayload => {
      const locationName = job.location?.name || (job.offices && job.offices[0]?.name) || 'Unspecified';
      const published = job.first_published || job.updated_at;

      return {
        externalId: String(job.id),
        source: this.source,
        title: (job.title || '').trim(),
        company: job.company_name || this.companyName,
        url: canonicalizeUrl(job.absolute_url || `https://boards.greenhouse.io/${this.boardToken}/jobs/${job.id}`),
        description: cleanHtml(job.content || ''),
        location: locationName,
        publishedAt: published ? new Date(published) : undefined,
        tags: [this.companyName, 'Greenhouse', ...(job.departments || []).map((d: any) => d?.name).filter(Boolean)],
      };
    });
  }
}
