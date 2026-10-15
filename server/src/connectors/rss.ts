import Parser from 'rss-parser';
import { JobConnector, JobListing, RawJobPayload, SOURCE_IDS } from './types';
import { cleanHtml, canonicalizeUrl, stableHash } from './utils';

/** Maps a typical job-board RSS/Atom item to a RawJobPayload. */
export function defaultRssItemMapper(feedName: string) {
  return (item: any): RawJobPayload => {
    const url = canonicalizeUrl(item.link || item.guid || '');
    const rawTitle = String(item.title || '').trim();
    // Many boards use "Role at Company" or "Company: Role" titles.
    const at = rawTitle.match(/^(.*)\s+at\s+(.+)$/i);
    const colon = rawTitle.match(/^([^:]{2,60}):\s+(.+)$/);
    const title = at ? at[1] : colon ? colon[2] : rawTitle;
    const company = item.creator || item.author || (at ? at[2] : colon ? colon[1] : feedName);
    return {
      externalId: String(item.guid || item.id || stableHash(url || rawTitle)),
      source: SOURCE_IDS.rss,
      title,
      company: String(company).trim(),
      url,
      description: cleanHtml(item['content:encoded'] || item.content || item.contentSnippet || item.summary || ''),
      location: item.location || undefined,
      publishedAt: item.isoDate ? new Date(item.isoDate) : item.pubDate ? new Date(item.pubDate) : undefined,
      tags: Array.isArray(item.categories) ? item.categories.map(String).slice(0, 8) : [],
    };
  };
}

export class RssConnector implements JobConnector {
  private parser: Parser;
  readonly name: string;
  readonly source = SOURCE_IDS.rss;
  readonly feedKey: string;

  constructor(
    private url: string,
    private mapItem: (item: any) => JobListing | RawJobPayload = defaultRssItemMapper('RSS feed'),
    name?: string
  ) {
    this.parser = new Parser();
    this.name = name || `RSS (${url})`;
    this.feedKey = `rss:${url}`;
  }

  async fetchJobs(): Promise<any[]> {
    const feed = await this.parser.parseURL(this.url);
    return feed.items.map(this.mapItem);
  }
}
