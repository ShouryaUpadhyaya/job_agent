/** Mirrors server/src/briefing/types.ts and the BriefingResponse from /api/briefing/*. */

export type BriefingTab = "PIPELINE" | "NETWORKING" | "GMAIL" | "DISCOVERY" | "WELLFOUND" | "BRIEFING";

export interface BriefingLink {
  tab: BriefingTab;
  id?: string;
  params?: Record<string, string>;
  label: string;
}

export interface BriefingItem {
  key: string;
  kind: string;
  title: string;
  detail?: string;
  tags?: string[];
  urgency: "high" | "normal" | "low";
  link?: BriefingLink;
  externalUrl?: string;
}

export type SectionKey = "actions" | "networking" | "matches" | "movement" | "wellfound" | "stale";

export interface BriefingSection {
  key: SectionKey;
  title: string;
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

export interface BriefingCounts {
  newApplicationsCount: number;
  interviewsCount: number;
  rejectionsCount: number;
  acceptedConnectionsCount: number;
  needsAttentionCount: number;
  offersCount: number;
  newMatchesCount: number;
  staleCount: number;
  wellfoundRunsCount: number;
}

export interface Briefing {
  version: 1;
  date: string;
  generatedAt: string;
  trigger: "scheduled" | "manual" | "on-demand" | "live";
  candidateName: string | null;
  inShort: { text: string; source: "gemini" | "rules" };
  counts: BriefingCounts;
  matchesSince: string;
  sections: BriefingSection[];
  stats: {
    thisWeek: WeekStats;
    lastWeek: WeekStats;
    thisWeekRange: { from: string; to: string };
    lastWeekRange: { from: string; to: string };
  };
}

export interface BriefingResponse {
  id: string | null;
  /** IST date "YYYY-MM-DD". */
  date: string;
  summaryDate: string;
  timezone: string;
  deliveryStatus: string;
  generatedAt: string;
  newApplicationsCount: number;
  interviewsCount: number;
  rejectionsCount: number;
  acceptedConnectionsCount: number;
  needsAttentionCount: number;
  content: string;
  briefing: Briefing | null;
  persisted: boolean;
}
