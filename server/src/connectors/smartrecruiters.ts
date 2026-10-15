import { JobConnector, RawJobPayload, SOURCE_IDS } from './types';
import { fetchWithRetry, cleanHtml, mapLimit, DEFAULT_HEADERS } from './utils';

const TECH_FUNCTIONS = new Set(['engineering', 'information_technology', 'research', 'quality_assurance']);
const TECH_TITLE_RE = /\b(engineer|developer|sde|software|intern|graduate|data|ml|devops|sre|backend|frontend|full[- ]?stack|qa|test|security|platform|cloud|programmer|analyst)\b/i;

/**
 * SmartRecruiters public Posting API:
 * https://developers.smartrecruiters.com/docs/posting-api (no auth for public postings).
 * The list endpoint has no descriptions, so details are fetched for tech roles only (capped).
 */
export class SmartRecruitersConnector implements JobConnector {
  readonly name: string;
  readonly source = SOURCE_IDS.smartrecruiters;
  readonly feedKey: string;

  constructor(
    private companyId: string,
    private companyName: string = companyId,
    private options: { maxPages?: number; maxDetails?: number; baseUrl?: string } = {}
  ) {
    this.name = `SmartRecruiters (${companyName})`;
    this.feedKey = `smartrecruiters:${companyId}`;
  }

  private get base(): string {
    return this.options.baseUrl || 'https://api.smartrecruiters.com';
  }

  static postingUrl(companyId: string, postingId: string): string {
    return `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyId)}/postings/${encodeURIComponent(postingId)}`;
  }

  async fetchJobs(): Promise<RawJobPayload[]> {
    const maxPages = this.options.maxPages ?? 10;
    const maxDetails = this.options.maxDetails ?? 60;
    const postings: any[] = [];

    for (let page = 0; page < maxPages; page++) {
      const url = `${this.base}/v1/companies/${encodeURIComponent(this.companyId)}/postings?limit=100&offset=${page * 100}`;
      const response = await fetchWithRetry(url, { headers: DEFAULT_HEADERS });
      if (!response.ok) {
        throw new Error(`SmartRecruiters API error (${response.status}): ${response.statusText}`);
      }
      const data: any = await response.json();
      const content = Array.isArray(data?.content) ? data.content : [];
      postings.push(...content);
      if (content.length < 100 || postings.length >= (data.totalFound ?? 0)) break;
    }

    const relevant = postings.filter(
      (p) => TECH_FUNCTIONS.has(p.function?.id) || TECH_TITLE_RE.test(p.name || '')
    );

    // Early-career and India postings get full descriptions first.
    const priority = (p: any) =>
      (/intern|entry|graduate|fresher/i.test(`${p.name} ${p.experienceLevel?.id}`) ? 0 : 1) +
      (p.location?.country === 'in' ? 0 : 1);
    const ordered = [...relevant].sort((a, b) => priority(a) - priority(b));

    return mapLimit(ordered, 4, async (posting, index): Promise<RawJobPayload> => {
      let detail: any = null;
      if (index < maxDetails) {
        try {
          const res = await fetchWithRetry(
            `${this.base}/v1/companies/${encodeURIComponent(this.companyId)}/postings/${encodeURIComponent(posting.id)}`,
            { headers: DEFAULT_HEADERS, maxRetries: 1 }
          );
          if (res.ok) detail = await res.json();
        } catch {
          detail = null;
        }
      }
      return this.toPayload(posting, detail);
    });
  }

  private toPayload(posting: any, detail: any | null): RawJobPayload {
    const loc = posting.location || {};
    const locationText =
      loc.fullLocation || [loc.city, loc.region, loc.country?.toUpperCase()].filter(Boolean).join(', ') || 'Unspecified';
    const remoteNote = loc.remote ? ' (Remote)' : loc.hybrid ? ' (Hybrid)' : '';

    const sections = detail?.jobAd?.sections || {};
    const description = detail
      ? cleanHtml(
          [sections.jobDescription?.text, sections.qualifications?.text, sections.additionalInformation?.text]
            .filter(Boolean)
            .join('\n\n')
        )
      : [posting.function?.label, posting.experienceLevel?.label, posting.typeOfEmployment?.label]
          .filter(Boolean)
          .join(' · ');

    const isIntern =
      /intern/i.test(posting.typeOfEmployment?.id || '') || posting.experienceLevel?.id === 'internship';
    const identifier = posting.company?.identifier || this.companyId;

    return {
      externalId: String(posting.id),
      source: this.source,
      title: String(posting.name || '').trim(),
      company: this.companyName,
      url: detail?.postingUrl || `https://jobs.smartrecruiters.com/${identifier}/${posting.id}`,
      description,
      location: locationText + remoteNote,
      publishedAt: posting.releasedDate ? new Date(posting.releasedDate) : undefined,
      employmentType: isIntern ? 'INTERNSHIP' : posting.typeOfEmployment?.label?.toUpperCase(),
      tags: [this.companyName, 'SmartRecruiters', posting.experienceLevel?.label].filter(Boolean),
    };
  }
}
