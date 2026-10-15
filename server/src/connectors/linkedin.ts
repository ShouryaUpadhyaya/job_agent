/**
 * LinkedIn jobs enter Job Agent only through job-alert emails or details the user pastes.
 * Nothing here contacts linkedin.com: LinkedIn's terms forbid automated access.
 */
import { RawJobPayload } from './types';
import { cleanHtml } from './utils';

export interface LinkedInImportInput {
  url: string;
  title: string;
  company: string;
  description: string;
  location?: string;
  isEasyApply?: boolean;
  workplaceType?: 'Remote' | 'On-site' | 'Hybrid';
  tags?: string[];
}

export interface ApplicationChecklist {
  steps: {
    title: string;
    description: string;
    done: boolean;
  }[];
  applicationType: 'EASY_APPLY' | 'EXTERNAL_ATS';
  handoffUrl: string;
}

export function extractLinkedInJobId(url: string): string {
  // e.g. https://www.linkedin.com/jobs/view/4021234567/ or .../software-engineer-intern-4021234567
  const viewMatch = url.match(/\/jobs\/view\/.*?(\d{8,12})/i);
  if (viewMatch && viewMatch[1]) {
    return viewMatch[1];
  }

  // e.g. currentJobId=4021234567
  const paramMatch = url.match(/currentJobId=(\d{8,12})/i);
  if (paramMatch && paramMatch[1]) {
    return paramMatch[1];
  }

  // Any 8-12 digit sequence
  const digitsMatch = url.match(/(\d{8,12})/);
  if (digitsMatch && digitsMatch[1]) {
    return digitsMatch[1];
  }

  // Fallback hash
  return 'li-' + Math.abs(url.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0)).toString(36);
}

export function normalizeLinkedInJob(input: LinkedInImportInput): RawJobPayload {
  const externalId = extractLinkedInJobId(input.url);
  const cleanDescription = cleanHtml(input.description || '');

  const tags = [...(input.tags || [])];
  if (input.isEasyApply) tags.push('Easy Apply');
  if (input.workplaceType) tags.push(input.workplaceType);

  return {
    externalId,
    source: 'linkedin',
    title: input.title.trim(),
    company: input.company.trim(),
    url: input.url.trim(),
    description: cleanDescription,
    location: input.location?.trim() || (input.workplaceType === 'Remote' ? 'Remote' : 'India / Remote'),
    tags,
  };
}

export function generatePreApplicationChecklist(job: {
  title: string;
  company: string;
  url: string;
  tags?: string[];
}): ApplicationChecklist {
  const isEasyApply = (job.tags || []).some(t => t.toLowerCase().includes('easy apply'));

  return {
    applicationType: isEasyApply ? 'EASY_APPLY' : 'EXTERNAL_ATS',
    handoffUrl: job.url,
    steps: [
      {
        title: 'Review Tailored Resume',
        description: `Ensure 1-page resume emphasizes keywords and skills matching ${job.title} at ${job.company}.`,
        done: false,
      },
      {
        title: 'Find Networking Referral Contact',
        description: `Check Networking CRM for alumni or engineers at ${job.company} before submitting.`,
        done: false,
      },
      {
        title: isEasyApply ? 'Prepare LinkedIn Easy Apply' : 'Complete External ATS Portal',
        description: isEasyApply
          ? 'Review phone number, experience years, and upload tailored PDF resume on LinkedIn.'
          : `Follow application handoff link directly to ${job.company}'s official career portal.`,
        done: false,
      },
      {
        title: 'Record Submitted Application in Pipeline',
        description: 'Mark application stage as APPLIED to track interview invitations and recruiter follow-ups.',
        done: false,
      },
    ],
  };
}
