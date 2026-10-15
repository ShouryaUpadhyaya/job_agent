import { JobConnector, RawJobPayload, SOURCE_IDS } from './types';
import { fetchWithRetry, cleanHtml, canonicalizeUrl, DEFAULT_HEADERS } from './utils';

/**
 * Workable public careers-widget API (the endpoint behind each company's apply.workable.com page):
 * https://apply.workable.com/api/v1/widget/accounts/{subdomain}?details=true
 */
export class WorkableConnector implements JobConnector {
  readonly name: string;
  readonly source = SOURCE_IDS.workable;
  readonly feedKey: string;

  constructor(
    private subdomain: string,
    private companyName?: string,
    private baseUrl?: string
  ) {
    this.name = `Workable (${companyName || subdomain})`;
    this.feedKey = `workable:${subdomain}`;
  }

  async fetchJobs(): Promise<RawJobPayload[]> {
    const url =
      this.baseUrl || `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(this.subdomain)}?details=true`;
    const response = await fetchWithRetry(url, { headers: DEFAULT_HEADERS });
    if (!response.ok) {
      throw new Error(`Workable API error (${response.status}): ${response.statusText}`);
    }
    const data: any = await response.json();
    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    const company = this.companyName || data?.name || this.subdomain;

    return jobs.map((job: any): RawJobPayload => {
      const location = [job.city, job.state, job.country].filter(Boolean).join(', ') || 'Unspecified';
      const isIntern = /intern/i.test(`${job.employment_type || ''} ${job.experience || ''}`);
      return {
        externalId: String(job.shortcode || job.id),
        source: this.source,
        title: String(job.title || '').trim(),
        company,
        url: canonicalizeUrl(job.url || job.shortlink || `https://apply.workable.com/j/${job.shortcode}`),
        description: cleanHtml(job.description || ''),
        location: location + (job.telecommuting ? ' (Remote)' : ''),
        publishedAt: job.published_on ? new Date(job.published_on) : job.created_at ? new Date(job.created_at) : undefined,
        employmentType: isIntern ? 'INTERNSHIP' : job.employment_type ? String(job.employment_type).toUpperCase() : undefined,
        tags: [company, 'Workable', job.department, job.experience].filter(Boolean),
      };
    });
  }
}
