import type { CompanyPeople } from "../networking";

export const STAGES = ["BOOKMARKED", "APPLYING", "APPLIED", "INTERVIEWING", "OFFERED", "REJECTED", "ARCHIVED"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_META: Record<Stage, { label: string; badge: string; column: string }> = {
  BOOKMARKED: { label: "Saved", badge: "bg-blue-50 text-blue-700 border-blue-200", column: "border-t-blue-400" },
  APPLYING: { label: "Preparing", badge: "bg-amber-50 text-amber-800 border-amber-200", column: "border-t-amber-400" },
  APPLIED: { label: "Applied", badge: "bg-purple-50 text-purple-700 border-purple-200", column: "border-t-purple-400" },
  INTERVIEWING: { label: "Interviewing", badge: "bg-emerald-50 text-emerald-700 border-emerald-200", column: "border-t-emerald-400" },
  OFFERED: { label: "Offer", badge: "bg-green-100 text-green-800 border-green-300", column: "border-t-green-500" },
  REJECTED: { label: "Rejected", badge: "bg-rose-50 text-rose-700 border-rose-200", column: "border-t-rose-300" },
  ARCHIVED: { label: "Archived", badge: "bg-slate-100 text-slate-600 border-slate-200", column: "border-t-slate-300" },
};

export function isStage(v: string): v is Stage {
  return (STAGES as readonly string[]).includes(v);
}

export function stageLabel(stage: string): string {
  return isStage(stage) ? STAGE_META[stage].label : `Unknown (${stage})`;
}

/** Mirrors server/src/lib/stages.ts statusForStage so optimistic updates show the right status. */
export function statusForStage(stage: Stage): string {
  if (stage === "BOOKMARKED" || stage === "APPLYING") return "DRAFT";
  if (stage === "APPLIED") return "SUBMITTED";
  return stage;
}

export const SOURCES = ["manual", "wellfound", "email", "import"] as const;
export const SOURCE_LABELS: Record<string, string> = {
  manual: "Added by you",
  wellfound: "Wellfound",
  email: "Gmail",
  import: "Imported",
};

export const SORTS = [
  { value: "fit", label: "Best fit" },
  { value: "match", label: "Resume match" },
  { value: "alumni", label: "VIT alumni there" },
  { value: "recent", label: "Recently updated" },
  { value: "applied", label: "Applied date" },
  { value: "company", label: "Company A–Z" },
] as const;
export type SortValue = (typeof SORTS)[number]["value"];

export const FIT_EXPLANATION =
  "Fit (0–100) = resume match (45) + VIT alumni at the company (20, maxes out at 3) + contacts there, more if one is engaged (10) + listing freshness (10) + stage momentum (10) + email in the last month (5). Rejected and archived applications score 0.";

export interface FitComponent {
  key: string;
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface PipelineJob {
  id: string;
  title: string;
  company: string;
  location: string | null;
  url: string;
  source: string;
  score: number;
  status: string;
  matchReasons: string[];
  matchedSkills: string[];
  missingSkills: string[];
  isActive: boolean;
  closedReason: string | null;
  closedAt: string | null;
  bestResumeId: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface PipelinePeople extends CompanyPeople {
  engagedCount?: number;
}

export interface PipelineApplication {
  id: string;
  jobListingId: string;
  stage: string;
  status: string;
  isApproved: boolean;
  notes: string | null;
  appliedUrl: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastEmailAt: string | null;
  source: string | null;
  companyKey: string;
  documentCount: number;
  emailCount: number;
  job: PipelineJob;
  people: PipelinePeople;
  fit: { score: number; closed: boolean; breakdown: FitComponent[] };
}

export interface PipelineStats {
  total: number;
  stages: Record<string, number>;
  other: number;
  sources: Record<string, number>;
}

export interface PipelineFilters {
  q: string;
  stages: Stage[];
  source: string;
  hasAlumni: boolean;
  sort: SortValue;
}

export type ApplicationPatch = Partial<Pick<PipelineApplication, "stage" | "notes">>;

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
