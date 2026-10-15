import { JobConnector, JobListing, RawJobPayload, SOURCE_IDS } from './types';
import { cleanHtml, canonicalizeUrl, stableHash } from './utils';

const pick = (obj: any, keys: string[]): any => {
  for (const k of keys) {
    const v = k.split('.').reduce((o, part) => (o == null ? undefined : o[part]), obj);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};

/**
 * Best-effort mapper for generic JSON job feeds: accepts an array or an object holding the
 * array under jobs/data/results/postings, and common field names for each property.
 */
export function defaultJsonMapper(feedName: string) {
  return (data: any): RawJobPayload[] => {
    const list = Array.isArray(data) ? data : pick(data, ['jobs', 'data', 'results', 'postings', 'items']) || [];
    if (!Array.isArray(list)) return [];
    return list
      .map((job: any): RawJobPayload | null => {
        const url = pick(job, ['url', 'absolute_url', 'link', 'apply_url', 'applyUrl', 'hostedUrl', 'jobUrl']);
        const title = pick(job, ['title', 'name', 'position', 'text', 'job_title']);
        if (!url || !title) return null;
        const published = pick(job, ['publishedAt', 'published_at', 'date', 'created_at', 'createdAt', 'posted_at']);
        const publishedDate = published
          ? new Date(typeof published === 'number' && published < 1e12 ? published * 1000 : published)
          : undefined;
        return {
          externalId: String(pick(job, ['id', 'slug', 'shortcode', 'job_id']) ?? stableHash(String(url))),
          source: SOURCE_IDS.jsonApi,
          title: String(title).trim(),
          company: String(pick(job, ['company', 'company_name', 'companyName', 'company.name', 'organization']) || feedName).trim(),
          url: canonicalizeUrl(String(url)),
          description: cleanHtml(String(pick(job, ['description', 'content', 'descriptionHtml', 'body', 'summary']) || '')),
          location: pick(job, ['location', 'location.name', 'candidate_required_location', 'city']) || undefined,
          publishedAt: publishedDate && !isNaN(publishedDate.getTime()) ? publishedDate : undefined,
          tags: Array.isArray(job.tags) ? job.tags.map(String).slice(0, 8) : [],
        };
      })
      .filter((j: RawJobPayload | null): j is RawJobPayload => j !== null);
  };
}

export class JsonApiConnector implements JobConnector {
  readonly name: string;
  readonly source = SOURCE_IDS.jsonApi;
  readonly feedKey: string;

  constructor(
    private url: string,
    private mapResponse: (data: any) => (JobListing | RawJobPayload)[] = defaultJsonMapper('JSON feed'),
    name?: string
  ) {
    this.name = name || `JSON API (${url})`;
    this.feedKey = `jsonapi:${url}`;
  }

  async fetchJobs(): Promise<any[]> {
    const response = await fetch(this.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch JSON API: ${response.statusText}`);
    }
    const data = await response.json();
    return this.mapResponse(data);
  }
}
