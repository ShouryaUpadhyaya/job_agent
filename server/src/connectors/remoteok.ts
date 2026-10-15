import { JobConnector, RawJobPayload, SOURCE_IDS } from './types';
import { fetchWithRetry, cleanHtml, DEFAULT_HEADERS } from './utils';

const DEV_TAGS = new Set([
  'dev', 'developer', 'engineer', 'engineering', 'software', 'backend', 'front end', 'frontend', 'full stack',
  'javascript', 'typescript', 'react', 'node', 'python', 'golang', 'java', 'devops', 'web dev', 'mobile',
]);

/**
 * Remote OK public API (https://remoteok.com/api). The first array element is a legal notice:
 * link back to the Remote OK URL and mention Remote OK as the source. We keep the
 * remoteok.com URL and tag listings "via Remote OK".
 */
export class RemoteOkConnector implements JobConnector {
  readonly name = 'Remote OK (remote dev jobs)';
  readonly source = SOURCE_IDS.remoteok;
  readonly feedKey = 'remoteok:dev';
  readonly minIntervalMs = 6 * 60 * 60 * 1000;

  constructor(private apiUrl: string = 'https://remoteok.com/api') {}

  async fetchJobs(): Promise<RawJobPayload[]> {
    const response = await fetchWithRetry(this.apiUrl, { headers: DEFAULT_HEADERS });
    if (!response.ok) {
      throw new Error(`Remote OK API error (${response.status}): ${response.statusText}`);
    }
    const data: any = await response.json();
    if (!Array.isArray(data)) return [];

    return data
      .filter((item: any) => item && item.id && item.position) // skips the legal-notice element
      .filter((item: any) => (item.tags || []).some((t: string) => DEV_TAGS.has(String(t).toLowerCase())))
      .map((job: any): RawJobPayload => ({
        externalId: String(job.id),
        source: this.source,
        title: String(job.position).trim(),
        company: String(job.company || 'Unknown company').trim(),
        url: String(job.url || `https://remoteok.com/remote-jobs/${job.slug || job.id}`),
        description: cleanHtml(job.description || ''),
        location: job.location ? `Remote (${job.location})` : 'Remote',
        publishedAt: job.date ? new Date(job.date) : job.epoch ? new Date(Number(job.epoch) * 1000) : undefined,
        tags: ['via Remote OK', ...(Array.isArray(job.tags) ? job.tags.slice(0, 8) : [])],
      }));
  }
}
