export const CLASSIFICATIONS = [
  "INTERVIEW_INVITATION",
  "ASSESSMENT",
  "OFFER",
  "APPLICATION_CONFIRMATION",
  "REJECTION",
  "RECRUITER_OUTREACH",
  "REFERRAL_RESPONSE",
  "FOLLOW_UP_REQUIRED",
  "LINKEDIN_CONNECTION_ACCEPTED",
  "JOB_ALERT",
  "UNRELATED",
  "UNKNOWN",
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const CLASSIFICATION_LABELS: Record<string, string> = {
  INTERVIEW_INVITATION: "Interview",
  ASSESSMENT: "Assessment",
  OFFER: "Offer",
  APPLICATION_CONFIRMATION: "Application confirmed",
  REJECTION: "Rejection",
  RECRUITER_OUTREACH: "Recruiter outreach",
  REFERRAL_RESPONSE: "Referral response",
  FOLLOW_UP_REQUIRED: "Follow-up needed",
  LINKEDIN_CONNECTION_ACCEPTED: "LinkedIn accepted",
  JOB_ALERT: "Job alert",
  UNRELATED: "Unrelated",
  UNKNOWN: "Unclassified",
};

export const CLASSIFICATION_TONES: Record<string, string> = {
  INTERVIEW_INVITATION: "bg-purple-50 text-purple-800 border-purple-200",
  ASSESSMENT: "bg-amber-50 text-amber-800 border-amber-200",
  OFFER: "bg-emerald-50 text-emerald-800 border-emerald-200",
  APPLICATION_CONFIRMATION: "bg-sky-50 text-sky-800 border-sky-200",
  REJECTION: "bg-rose-50 text-rose-800 border-rose-200",
  RECRUITER_OUTREACH: "bg-indigo-50 text-indigo-800 border-indigo-200",
  REFERRAL_RESPONSE: "bg-teal-50 text-teal-800 border-teal-200",
  FOLLOW_UP_REQUIRED: "bg-orange-50 text-orange-800 border-orange-200",
  LINKEDIN_CONNECTION_ACCEPTED: "bg-blue-50 text-blue-800 border-blue-200",
  JOB_ALERT: "bg-slate-50 text-slate-600 border-slate-200",
  UNRELATED: "bg-slate-50 text-slate-500 border-slate-200",
  UNKNOWN: "bg-slate-50 text-slate-500 border-slate-200",
};

export type Importance = "HIGH" | "NORMAL" | "LOW";

export interface EmailEvent {
  id: string;
  messageId: string;
  sender: string;
  senderName?: string | null;
  subject: string;
  snippet?: string | null;
  receivedAt: string;
  classification: string;
  confidence: number;
  importance?: Importance;
  isDemo?: boolean;
  explanation?: string | null;
  suggestedAction?: string | null;
  company?: string | null;
  role?: string | null;
  jobApplication?: { id: string; stage: string; jobListing: { title: string; company: string } } | null;
  networkingContact?: { id: string; name: string; company: string; status?: string } | null;
}

export interface SyncStats {
  startedAt: string;
  finishedAt: string;
  after: string;
  fetched: number;
  new: number;
  skipped: number;
  errors: number;
  remaining: number;
  truncated?: boolean;
  byClassification: Record<string, number>;
  stageChanges: number;
  applicationsCreated: number;
  contactsCreated: number;
  jobAlertListings: number;
}

export interface GmailStatus {
  configured: boolean;
  missingEnv: string[];
  redirectUri: string;
  setup: string[];
  connected: boolean;
  accountStatus: "CONNECTED" | "EXPIRED" | "DISCONNECTED" | "REVOKED" | null;
  email: string | null;
  lastSyncedAt: string | null;
  lastSync: SyncStats | null;
  lastError: { at: string; code: string; message: string; fix?: string } | null;
  totalEventsTracked: number;
  demoEvents: number;
}

export interface NeedsActionItem {
  eventId: string;
  kind: "INTERVIEW" | "ASSESSMENT" | "OFFER" | "RECRUITER_REPLY" | "FOLLOW_UP";
  subject: string;
  company: string | null;
  role: string | null;
  sender: string;
  senderName: string | null;
  deadline: string | null;
  receivedAt: string;
  suggestedAction: string | null;
  application: { id: string; stage: string; title: string; company: string } | null;
  contact: { id: string; name: string; company: string; status: string } | null;
  link: string;
}

export interface GmailSummary {
  days: number;
  totalEvents: number;
  counts: Record<string, number>;
  needsAction: NeedsActionItem[];
  statusChanges: { eventId: string; applicationId: string; company: string; title: string; from: string; to: string; at: string; currentStage: string }[];
  newApplications: { id: string; company: string; title: string; stage: string; createdAt: string }[];
  jobAlerts: { emails: number; listingsAdded: number };
  highlights: string[];
  aiSummary: string | null;
}

export const KIND_LABELS: Record<NeedsActionItem["kind"], string> = {
  OFFER: "Offer",
  INTERVIEW: "Interview",
  ASSESSMENT: "Assessment",
  RECRUITER_REPLY: "Reply",
  FOLLOW_UP: "Follow-up",
};

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
