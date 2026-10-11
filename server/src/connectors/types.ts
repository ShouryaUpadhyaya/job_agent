export interface JobListing {
  id: string;
  title: string;
  company: string;
  location?: string;
  url: string;
  description?: string;
  publishedAt?: Date;
  source?: string;
  externalId?: string;
  tags?: string[];
  score?: number;
  status?: string;
}

export interface RawJobPayload {
  externalId: string;
  source: string;
  title: string;
  company: string;
  url: string;
  description: string;
  location?: string;
  publishedAt?: Date;
  tags?: string[];
}

export interface JobConnector {
  readonly name?: string;
  readonly source?: string;
  fetchJobs(): Promise<JobListing[] | RawJobPayload[]>;
}
