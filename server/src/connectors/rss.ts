import Parser from 'rss-parser';
import { JobConnector, JobListing } from './types';

export class RssConnector implements JobConnector {
  private parser: Parser;

  constructor(
    private url: string,
    private mapItem: (item: any) => JobListing
  ) {
    this.parser = new Parser();
  }

  async fetchJobs(): Promise<JobListing[]> {
    const feed = await this.parser.parseURL(this.url);
    return feed.items.map(this.mapItem);
  }
}
