export type Job = {
  id: string;
  title: string;
  company: string;
  location?: string | null;
  source: string;
  sourceLabel?: string;
  url: string;
  description: string;
  descriptionTruncated?: boolean;
  score: number;
  status?: string;
  matchReasons?: string[];
  matchedSkills?: string[];
  missingSkills?: string[];
  tags?: string[];
  isInternship?: boolean;
  isActive?: boolean;
  userStatus?: "NONE" | "SAVED" | "DISMISSED";
  bestResumeId?: string | null;
  bestResumeLabel?: string | null;
  appliedStage?: string | null;
  applicationId?: string | null;
  attribution?: { label: string; url: string } | null;
  freshness?: {
    postedAt: string | null;
    postedAtIsEstimate: boolean;
    ageDays: number | null;
    lastSeenAt?: string | null;
    lastCheckedAt?: string | null;
  };
  verified?: boolean;
  verificationLabel?: string;
};

export type JobsPage = {
  jobs: Job[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export type Facets = {
  sources: { value: string; label: string; count: number }[];
  total: number;
  internships: number;
  saved: number;
  dismissed: number;
  closed: number;
  resumes: { id: string; label: string }[];
};

export type Filters = {
  q: string;
  internshipOnly: boolean;
  postedWithinDays: number | "";
  sources: string[];
  location: string;
  remote: boolean;
  minScore: number;
  status: string;
  hideApplied: boolean;
  showDismissed: boolean;
  savedOnly: boolean;
  resumeId: string;
  sort: "best" | "newest" | "company";
};

export const DEFAULT_FILTERS: Filters = {
  q: "",
  internshipOnly: false,
  postedWithinDays: "",
  sources: [],
  location: "",
  remote: false,
  minScore: 0,
  status: "ALL",
  hideApplied: false,
  showDismissed: false,
  savedOnly: false,
  resumeId: "",
  sort: "best",
};

export type SearchLink = {
  id: string;
  site: string;
  label: string;
  url: string;
  description: string;
  group: "job-boards" | "ats-search" | "social";
};

export type XSources = {
  checkedAt: string;
  note: string;
  searchUrl: string;
  accounts: { handle: string; name: string; url: string; posts: string; evidence: string; evidenceUrl: string }[];
};

export type Profile = {
  id: string;
  name: string;
  targetRole?: string | null;
  targetGradYear?: number | null;
  school?: string | null;
  skills: string[];
  preferredLocations?: string[];
};

/** Query string for GET /api/jobs. */
export function filtersToQuery(f: Filters, page: number, pageSize: number) {
  return {
    page,
    pageSize,
    sort: f.sort,
    q: f.q.trim() || undefined,
    internshipOnly: f.internshipOnly || undefined,
    postedWithinDays: f.postedWithinDays || undefined,
    sources: f.sources.length ? f.sources : undefined,
    location: f.location.trim() || undefined,
    remote: f.remote || undefined,
    minScore: f.minScore || undefined,
    status: f.status !== "ALL" ? f.status : undefined,
    hideApplied: f.hideApplied || undefined,
    hideDismissed: f.showDismissed ? false : undefined,
    savedOnly: f.savedOnly || undefined,
    resumeId: f.resumeId || undefined,
  };
}

export function freshnessText(job: Job): string {
  const days = job.freshness?.ageDays;
  if (days === null || days === undefined) return "Date unknown";
  const prefix = job.freshness?.postedAtIsEstimate ? "Added" : "Posted";
  if (days <= 0) return `${prefix} today`;
  if (days === 1) return `${prefix} yesterday`;
  if (days < 30) return `${prefix} ${days}d ago`;
  return `${prefix} ${Math.floor(days / 30)}mo ago`;
}

export function freshnessTone(job: Job): string {
  const days = job.freshness?.ageDays ?? 999;
  if (days <= 3) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (days <= 14) return "bg-sky-50 text-sky-700 border-sky-200";
  if (days <= 30) return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-rose-50 text-rose-700 border-rose-200";
}

export function statusTone(status?: string): string {
  switch (status) {
    case "APPLY":
      return "bg-emerald-100 text-emerald-800 border-emerald-300";
    case "REVIEW":
      return "bg-amber-100 text-amber-800 border-amber-300";
    case "SKIP":
      return "bg-gray-100 text-gray-600 border-gray-300";
    default:
      return "bg-blue-100 text-blue-800 border-blue-300";
  }
}

/** Splits matchReasons into positive chips, disqualifications and concerns. */
export function splitReasons(reasons: string[] = []) {
  return {
    why: reasons.filter((r) => !r.startsWith("SKIP: ") && !r.startsWith("CHECK: ")),
    skip: reasons.filter((r) => r.startsWith("SKIP: ")).map((r) => r.slice(6)),
    check: reasons.filter((r) => r.startsWith("CHECK: ")).map((r) => r.slice(7)),
  };
}
