export interface JobListing {
  id: string;
  title: string;
  company: string;
  location?: string;
  url: string;
  description?: string;
  publishedAt?: Date;
}

export interface JobConnector {
  fetchJobs(): Promise<JobListing[]>;
}
