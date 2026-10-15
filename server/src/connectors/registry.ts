import { JobConnector } from './types';
import { GreenhouseConnector } from './greenhouse';
import { AshbyConnector } from './ashby';
import { LeverConnector } from './lever';
import { ArbeitnowConnector } from './arbeitnow';
import { SmartRecruitersConnector } from './smartrecruiters';
import { WorkableConnector } from './workable';
import { RemotiveConnector } from './remotive';
import { RemoteOkConnector } from './remoteok';
import { RssConnector, defaultRssItemMapper } from './rss';
import { JsonApiConnector, defaultJsonMapper } from './jsonApi';
import { isRestrictedHost } from './utils';

export interface SourceTypeInfo {
  type: string;
  label: string;
  /** What the board token means for this type. */
  tokenLabel: string;
  tokenRequired: boolean;
  example: string;
}

export const SUPPORTED_SOURCE_TYPES: SourceTypeInfo[] = [
  { type: 'greenhouse', label: 'Greenhouse', tokenLabel: 'Board token (boards.greenhouse.io/<token>)', tokenRequired: true, example: 'stripe' },
  { type: 'lever', label: 'Lever', tokenLabel: 'Company slug (jobs.lever.co/<slug>)', tokenRequired: true, example: 'meesho' },
  { type: 'ashby', label: 'Ashby', tokenLabel: 'Org slug (jobs.ashbyhq.com/<slug>)', tokenRequired: true, example: 'sarvam' },
  { type: 'smartrecruiters', label: 'SmartRecruiters', tokenLabel: 'Company id (jobs.smartrecruiters.com/<Id>, case-sensitive)', tokenRequired: true, example: 'Freshworks' },
  { type: 'workable', label: 'Workable', tokenLabel: 'Account subdomain (apply.workable.com/<sub>)', tokenRequired: true, example: 'apna' },
  { type: 'remotive', label: 'Remotive', tokenLabel: 'Category (default software-dev)', tokenRequired: false, example: 'software-dev' },
  { type: 'remoteok', label: 'Remote OK', tokenLabel: 'Not needed', tokenRequired: false, example: '' },
  { type: 'arbeitnow', label: 'Arbeitnow', tokenLabel: 'Not needed', tokenRequired: false, example: '' },
  { type: 'rss', label: 'RSS / Atom feed', tokenLabel: 'Feed URL', tokenRequired: true, example: 'https://example.com/jobs.rss' },
  { type: 'jsonapi', label: 'JSON feed', tokenLabel: 'Feed URL', tokenRequired: true, example: 'https://example.com/jobs.json' },
];

/** Source types that used to exist but violate the site's terms; rows of these are disabled. */
export const UNSUPPORTED_SOURCE_TYPES: Record<string, string> = {
  linkedin:
    'LinkedIn forbids automated access. Use LinkedIn job-alert emails (Gmail sync), the search links, or paste job details.',
  wellfound:
    'Wellfound has no public jobs API. Wellfound jobs come from the auto-apply CSV, alert emails and manual imports.',
};

export function normalizeSourceType(sourceType: string): string {
  const t = sourceType.trim().toLowerCase();
  return t === 'json' || t === 'json-api' || t === 'json_api' ? 'jsonapi' : t;
}

export function isSupportedSourceType(sourceType: string): boolean {
  return SUPPORTED_SOURCE_TYPES.some((s) => s.type === normalizeSourceType(sourceType));
}

/** Returns an error message if the token is unusable for the type, else null. */
export function validateSourceToken(sourceType: string, boardToken: string): string | null {
  const type = normalizeSourceType(sourceType);
  const info = SUPPORTED_SOURCE_TYPES.find((s) => s.type === type);
  if (!info) return `Unsupported source type '${sourceType}'`;
  if (info.tokenRequired && !boardToken) return `${info.label} needs: ${info.tokenLabel}`;
  if (type === 'rss' || type === 'jsonapi') {
    let parsed: URL;
    try {
      parsed = new URL(boardToken);
    } catch {
      return 'Feed URL must be a valid http(s) URL';
    }
    if (!/^https?:$/.test(parsed.protocol)) return 'Feed URL must be http(s)';
    if (isRestrictedHost(boardToken)) return 'LinkedIn/Naukri URLs cannot be fetched automatically (terms of service)';
  } else if (boardToken && !/^[A-Za-z0-9._-]+$/.test(boardToken)) {
    return 'Board token may only contain letters, digits, dot, dash and underscore';
  }
  return null;
}

export function createConnector(config: { sourceType: string; boardToken: string; name: string }): JobConnector | null {
  const token = (config.boardToken || '').trim();
  switch (normalizeSourceType(config.sourceType)) {
    case 'greenhouse':
      return new GreenhouseConnector(token, config.name);
    case 'ashby':
      return new AshbyConnector(token, config.name);
    case 'lever':
      return new LeverConnector(token, config.name);
    case 'smartrecruiters':
      return new SmartRecruitersConnector(token, config.name);
    case 'workable':
      return new WorkableConnector(token, config.name);
    case 'remotive':
      return new RemotiveConnector(token && token !== 'global' ? token : 'software-dev');
    case 'remoteok':
      return new RemoteOkConnector();
    case 'arbeitnow':
      return new ArbeitnowConnector();
    case 'rss':
      return isRestrictedHost(token) ? null : new RssConnector(token, defaultRssItemMapper(config.name), config.name);
    case 'jsonapi':
      return isRestrictedHost(token) ? null : new JsonApiConnector(token, defaultJsonMapper(config.name), config.name);
    default:
      // linkedin / wellfound rows from older versions and unknown types are skipped.
      return null;
  }
}

/**
 * Curated default sources: companies that hire software interns/freshers in India or remotely,
 * each verified against its public ATS API (see docs/JOB_SOURCES.md for the verification date
 * and counts). ensureDefaultSources() adds missing ones and never deletes user-added sources.
 */
export const DEFAULT_SOURCES: { sourceType: string; boardToken: string; name: string }[] = [
  // Greenhouse
  { sourceType: 'greenhouse', boardToken: 'razorpaysoftwareprivatelimited', name: 'Razorpay' },
  { sourceType: 'greenhouse', boardToken: 'groww', name: 'Groww' },
  { sourceType: 'greenhouse', boardToken: 'databricks', name: 'Databricks' },
  { sourceType: 'greenhouse', boardToken: 'stripe', name: 'Stripe' },
  { sourceType: 'greenhouse', boardToken: 'coinbase', name: 'Coinbase' },
  { sourceType: 'greenhouse', boardToken: 'mongodb', name: 'MongoDB' },
  { sourceType: 'greenhouse', boardToken: 'rubrik', name: 'Rubrik' },
  { sourceType: 'greenhouse', boardToken: 'twilio', name: 'Twilio' },
  { sourceType: 'greenhouse', boardToken: 'okta', name: 'Okta' },
  { sourceType: 'greenhouse', boardToken: 'hackerrank', name: 'HackerRank' },
  { sourceType: 'greenhouse', boardToken: 'zscaler', name: 'Zscaler' },
  { sourceType: 'greenhouse', boardToken: 'gitlab', name: 'GitLab' },
  { sourceType: 'greenhouse', boardToken: 'highradius', name: 'HighRadius' },
  { sourceType: 'greenhouse', boardToken: 'druva', name: 'Druva' },
  { sourceType: 'greenhouse', boardToken: 'netskope', name: 'Netskope' },
  { sourceType: 'greenhouse', boardToken: 'inmobi', name: 'InMobi' },
  { sourceType: 'greenhouse', boardToken: 'observeai', name: 'Observe.AI' },
  { sourceType: 'greenhouse', boardToken: 'cloudflare', name: 'Cloudflare' },
  // Lever
  { sourceType: 'lever', boardToken: 'cred', name: 'CRED' },
  { sourceType: 'lever', boardToken: 'meesho', name: 'Meesho' },
  { sourceType: 'lever', boardToken: 'zeta', name: 'Zeta' },
  { sourceType: 'lever', boardToken: 'fampay', name: 'FamPay' },
  { sourceType: 'lever', boardToken: 'paytm', name: 'Paytm' },
  { sourceType: 'lever', boardToken: 'outreach', name: 'Outreach' },
  // Ashby
  { sourceType: 'ashby', boardToken: 'sarvam', name: 'Sarvam AI' },
  { sourceType: 'ashby', boardToken: 'plane', name: 'Plane' },
  { sourceType: 'ashby', boardToken: 'composio', name: 'Composio' },
  { sourceType: 'ashby', boardToken: 'spotdraft', name: 'SpotDraft' },
  { sourceType: 'ashby', boardToken: 'atlan', name: 'Atlan' },
  { sourceType: 'ashby', boardToken: 'posthog', name: 'PostHog' },
  { sourceType: 'ashby', boardToken: 'notion', name: 'Notion' },
  { sourceType: 'ashby', boardToken: 'clickhouse', name: 'ClickHouse' },
  { sourceType: 'ashby', boardToken: 'linear', name: 'Linear' },
  // SmartRecruiters
  { sourceType: 'smartrecruiters', boardToken: 'Freshworks', name: 'Freshworks' },
  { sourceType: 'smartrecruiters', boardToken: 'ServiceNow', name: 'ServiceNow' },
  { sourceType: 'smartrecruiters', boardToken: 'Swiggy', name: 'Swiggy' },
  { sourceType: 'smartrecruiters', boardToken: 'Experian', name: 'Experian' },
  // Workable
  { sourceType: 'workable', boardToken: 'apna', name: 'Apna' },
  // Remote-job aggregators (attribution required; polled at most every 6h)
  { sourceType: 'remotive', boardToken: 'software-dev', name: 'Remotive (software dev)' },
  { sourceType: 'remoteok', boardToken: 'dev', name: 'Remote OK (dev)' },
];
