import { JobConnector, JobListing } from './types';

export class JsonApiConnector implements JobConnector {
  constructor(
    private url: string,
    private mapResponse: (data: any) => JobListing[]
  ) {}

  async fetchJobs(): Promise<JobListing[]> {
    const response = await fetch(this.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch JSON API: ${response.statusText}`);
    }
    const data = await response.json();
    return this.mapResponse(data);
  }
}
