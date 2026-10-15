/**
 * Structured daily briefing. The same object drives the rendered markdown (stored in
 * DailyJobSearchSummary.content) and the card UI.
 */

export const BRIEFING_TABS = ['PIPELINE', 'NETWORKING', 'GMAIL', 'DISCOVERY', 'WELLFOUND', 'BRIEFING'] as const;
export type BriefingTab = (typeof BRIEFING_TABS)[number];

/** Deep link into the dashboard: `?tab=<tab>` plus an optional record id. */
export interface BriefingLink {
  tab: BriefingTab;
  id?: string;
  /** Extra query parameters (e.g. `companyKey` for the Networking tab). */
  params?: Record<string, string>;
  label: string;
}

export type BriefingUrgency = 'high' | 'normal' | 'low';

export interface BriefingItem {
  /** Stable key for React lists ("<kind>:<record id>"). */
  key: string;
  kind: string;
  title: string;
  detail?: string;
  /** Short tags shown as chips ("VIT alumni", "Draft ready", "Backend resume"). */
  tags?: string[];
  urgency: BriefingUrgency;
  link?: BriefingLink;
  /** Outbound link (job posting). */
  externalUrl?: string;
}

export const SECTION_KEYS = ['actions', 'networking', 'matches', 'movement', 'wellfound', 'stale'] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export interface BriefingSection {
  key: SectionKey;
  title: string;
  /** One-line context ("3 of 8 stale applications shown"). */
  summary?: string;
  emptyText: string;
  items: BriefingItem[];
}

export interface WeekStats {
  applications: number;
  responses: number;
  interviews: number;
  contactsMessaged: number;
}

export interface BriefingStats {
  thisWeek: WeekStats;
  lastWeek: WeekStats;
  /** Inclusive IST date ranges the two weeks cover. */
  thisWeekRange: { from: string; to: string };
  lastWeekRange: { from: string; to: string };
}

/** Values stored in the DailyJobSearchSummary count columns. */
export interface BriefingMetrics {
  newApplicationsCount: number;
  interviewsCount: number;
  rejectionsCount: number;
  acceptedConnectionsCount: number;
  needsAttentionCount: number;
}

export interface BriefingCounts extends BriefingMetrics {
  offersCount: number;
  newMatchesCount: number;
  staleCount: number;
  wellfoundRunsCount: number;
}

export type BriefingTrigger = 'scheduled' | 'manual' | 'on-demand' | 'live';

export interface Briefing {
  version: 1;
  /** IST calendar date, "YYYY-MM-DD". */
  date: string;
  generatedAt: string;
  trigger: BriefingTrigger;
  candidateName: string | null;
  inShort: { text: string; source: 'gemini' | 'rules' };
  counts: BriefingCounts;
  /** Start of the "new matches" window (previous briefing, or 24h before). */
  matchesSince: string;
  sections: BriefingSection[];
  stats: BriefingStats;
}
