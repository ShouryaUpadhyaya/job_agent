import { RawJobPayload } from './types';
import { cleanHtml } from './utils';

export interface WellfoundImportInput {
  url: string;
  title: string;
  company: string;
  description: string;
  location?: string;
  salary?: string;
  equity?: string;
  stage?: string;
  tags?: string[];
}

export function extractWellfoundJobId(url: string): string {
  // e.g. https://wellfound.com/jobs/3124567-software-engineer or https://angel.co/company/stripe/jobs/1234
  const match = url.match(/jobs\/(\d+)/i) || url.match(/\/(\d+)-/);
  if (match && match[1]) {
    return match[1];
  }

  // Fallback hash of URL
  return 'wf-' + Math.abs(url.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0)).toString(36);
}

export function normalizeWellfoundJob(input: WellfoundImportInput): RawJobPayload {
  const externalId = extractWellfoundJobId(input.url);
  const cleanDescription = cleanHtml(input.description || '');

  const tags = [...(input.tags || [])];
  if (input.stage) tags.push(input.stage);
  if (input.salary) tags.push(`Salary: ${input.salary}`);
  if (input.equity) tags.push(`Equity: ${input.equity}`);

  return {
    externalId,
    source: 'wellfound',
    title: input.title.trim(),
    company: input.company.trim(),
    url: input.url.trim(),
    description: cleanDescription,
    location: input.location?.trim() || 'Remote',
    publishedAt: new Date(),
    tags,
  };
}

import { JobConnector } from './types';

export class WellfoundConnector implements JobConnector {
  public readonly name: string;
  public readonly source = 'wellfound';

  constructor(name: string = 'Wellfound Startups') {
    this.name = name;
  }

  async fetchJobs(): Promise<RawJobPayload[]> {
    return [
      {
        externalId: 'wf-startup-1',
        source: 'wellfound',
        title: 'Founding Backend Engineer',
        company: 'Superfluid AI',
        location: 'Remote',
        url: 'https://wellfound.com/jobs/3120194-founding-backend-engineer',
        description: 'Superfluid AI is building real-time data streaming engines for agents. Looking for strong TypeScript, Node.js, and PostgreSQL developers with passion for distributed architectures.',
        publishedAt: new Date(),
        tags: ['Seed', 'Salary: $130k - $160k', 'Equity: 0.25% - 1.0%', 'Remote'],
      },
      {
        externalId: 'wf-startup-2',
        source: 'wellfound',
        title: 'Full Stack Engineering Intern',
        company: 'Resend',
        location: 'Remote',
        url: 'https://wellfound.com/jobs/3120195-full-stack-intern',
        description: 'Join Resend building email infrastructure for developers. Work with Next.js, Node.js, PostgreSQL, and high-throughput queuing systems.',
        publishedAt: new Date(),
        tags: ['Series A', 'Internship', 'Remote', 'Developer Tools'],
      },
      {
        externalId: 'wf-startup-3',
        source: 'wellfound',
        title: 'Systems & Infrastructure Intern',
        company: 'PostHog',
        location: 'Remote',
        url: 'https://wellfound.com/jobs/3120196-systems-infra-intern',
        description: 'Open source product analytics and feature flags. Work with Python, Go, ClickHouse, and distributed event ingestion pipelines.',
        publishedAt: new Date(),
        tags: ['Series B', 'Open Source', 'Remote', 'Internship'],
      },
    ];
  }
}

