/**
 * Wellfound jobs come from the auto-apply runner's CSV, Wellfound alert emails and manual
 * imports. There is no Wellfound feed connector (no public API).
 */
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
    tags,
  };
}
