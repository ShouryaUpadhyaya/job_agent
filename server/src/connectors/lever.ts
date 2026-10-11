import { JobConnector, RawJobPayload } from './types';
import { fetchWithRetry, cleanHtml, canonicalizeUrl } from './utils';

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  descriptionPlain?: string;
  description?: string;
  additional?: string;
  categories?: {
    commitment?: string;
    department?: string;
    location?: string;
    team?: string;
    allLocations?: string[];
  };
  createdAt?: number;
}

export class LeverConnector implements JobConnector {
  public source = 'lever';
  public readonly name: string;
  private company: string;
  private companyDisplayName: string;

  constructor(company: string = 'spotify', companyDisplayName?: string) {
    this.company = company;
    this.companyDisplayName = companyDisplayName || company.charAt(0).toUpperCase() + company.slice(1);
    this.name = this.companyDisplayName;
  }

  getEndpoint(): string {
    return `https://api.lever.co/v0/postings/${encodeURIComponent(this.company)}?mode=json`;
  }

  async fetchJobs(): Promise<RawJobPayload[]> {
    const url = this.getEndpoint();
    const response = await fetchWithRetry(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'JobAgent/1.0',
      },
    });

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
      if (!location) {
        location = 'Remote / Unspecified';
      }

      const rawDescription = post.description || post.descriptionPlain || '';
      const additional = post.additional ? `\n\n${post.additional}` : '';
      const fullDescription = cleanHtml(rawDescription + additional);

      return {
        externalId: post.id,
        source: 'lever',
        title: (post.text || 'Untitled Role').trim(),
        company: this.companyDisplayName,
        url: canonicalizeUrl(post.hostedUrl || post.applyUrl || `https://jobs.lever.co/${this.company}/${post.id}`),
        description: fullDescription || 'No description provided.',
        location,
        publishedAt: post.createdAt ? new Date(post.createdAt) : new Date(),
        tags: [this.companyDisplayName, 'Lever'],
      };
    });
  }
}
