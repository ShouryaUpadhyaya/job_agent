import { JobConnector, RawJobPayload, SOURCE_IDS } from './types';
import { fetchWithRetry, cleanHtml, canonicalizeUrl, DEFAULT_HEADERS } from './utils';

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  descriptionPlain?: string;
  description?: string;
  additional?: string;
  lists?: { text?: string; content?: string }[];
  workplaceType?: string;
  categories?: {
    commitment?: string;
    department?: string;
    location?: string;
    team?: string;
    allLocations?: string[];
  };
  createdAt?: number;
}

/** Public Lever postings API: https://github.com/lever/postings-api */
export class LeverConnector implements JobConnector {
  public readonly source = SOURCE_IDS.lever;
  public readonly name: string;
  public readonly feedKey: string;
  private company: string;
  private companyDisplayName: string;

  constructor(company: string = 'spotify', companyDisplayName?: string) {
    this.company = company;
    this.companyDisplayName = companyDisplayName || company.charAt(0).toUpperCase() + company.slice(1);
    this.name = this.companyDisplayName;
    this.feedKey = `lever:${company}`;
  }

  getEndpoint(): string {
    return `https://api.lever.co/v0/postings/${encodeURIComponent(this.company)}?mode=json`;
  }

  static postingUrl(company: string, id: string): string {
    return `https://api.lever.co/v0/postings/${encodeURIComponent(company)}/${encodeURIComponent(id)}?mode=json`;
  }

  async fetchJobs(): Promise<RawJobPayload[]> {
    const response = await fetchWithRetry(this.getEndpoint(), { headers: DEFAULT_HEADERS });

    if (!response.ok) {
      throw new Error(`Lever API error for ${this.company} (${response.status}): ${response.statusText}`);
    }

    const postings: any = await response.json();

    if (!Array.isArray(postings)) {
      throw new Error(`Unexpected Lever API response format for ${this.company}: expected array`);
    }

    return postings.map((post: LeverPosting): RawJobPayload => {
      let location = post.categories?.location || '';
      if (!location && Array.isArray(post.categories?.allLocations) && post.categories.allLocations.length > 0) {
        location = post.categories.allLocations.join(', ');
      }
      if (post.workplaceType === 'remote' && !/remote/i.test(location)) {
        location = location ? `${location} (Remote)` : 'Remote';
      }
      if (!location) {
        location = 'Unspecified';
      }

      const lists = (post.lists || []).map((l) => `${l.text || ''}\n${l.content || ''}`).join('\n');
      const rawDescription = [post.description || post.descriptionPlain || '', lists, post.additional || '']
        .filter(Boolean)
        .join('\n\n');
      const commitment = post.categories?.commitment || '';

      return {
        externalId: post.id,
        source: this.source,
        title: (post.text || 'Untitled Role').trim(),
        company: this.companyDisplayName,
        url: canonicalizeUrl(post.hostedUrl || post.applyUrl || `https://jobs.lever.co/${this.company}/${post.id}`),
        description: cleanHtml(rawDescription) || 'No description provided.',
        location,
        publishedAt: post.createdAt ? new Date(post.createdAt) : undefined,
        employmentType: /intern/i.test(commitment) ? 'INTERNSHIP' : commitment ? commitment.toUpperCase() : undefined,
        tags: [this.companyDisplayName, 'Lever', ...(commitment ? [commitment] : [])],
      };
    });
  }
}
