import { JobConnector, RawJobPayload, SOURCE_IDS } from './types';
import { fetchWithRetry, cleanHtml, DEFAULT_HEADERS } from './utils';

/**
 * Remotive public API (https://remotive.com/api-documentation). Terms: link back to the
 * Remotive URL, credit Remotive as the source, and poll at most ~4 times a day.
 * Listings keep their remotive.com URL and carry a "via Remotive" tag for attribution.
 */
export class RemotiveConnector implements JobConnector {
  readonly name = 'Remotive (remote software jobs)';
  readonly source = SOURCE_IDS.remotive;
  readonly feedKey: string;
  readonly minIntervalMs = 6 * 60 * 60 * 1000;

  constructor(private category: string = 'software-dev', private baseUrl?: string) {
    this.feedKey = `remotive:${category}`;
  }

  async fetchJobs(): Promise<RawJobPayload[]> {
    const url = this.baseUrl || `https://remotive.com/api/remote-jobs?category=${encodeURIComponent(this.category)}`;
    const response = await fetchWithRetry(url, { headers: DEFAULT_HEADERS });
    if (!response.ok) {
      throw new Error(`Remotive API error (${response.status}): ${response.statusText}`);
    }
    const data: any = await response.json();
    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];

    return jobs.map((job: any): RawJobPayload => ({
      externalId: String(job.id),
      source: this.source,
      title: String(job.title || '').trim(),
      company: String(job.company_name || 'Unknown company').trim(),
      url: String(job.url),
      description: cleanHtml(job.description || ''),
      location: `Remote (${job.candidate_required_location || 'Worldwide'})`,
      publishedAt: job.publication_date ? new Date(job.publication_date) : undefined,
      employmentType: job.job_type === 'internship' ? 'INTERNSHIP' : job.job_type ? String(job.job_type).toUpperCase() : undefined,
      tags: ['via Remotive', ...(Array.isArray(job.tags) ? job.tags.slice(0, 8) : [])],
    }));
  }
}
