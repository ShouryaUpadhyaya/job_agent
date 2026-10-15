export const CONTACT_STATUSES = [
  "RESEARCHED",
  "READY_TO_CONNECT",
  "REQUEST_SENT",
  "ACCEPTED",
  "MESSAGE_DRAFTED",
  "MESSAGE_SENT",
  "REPLIED",
  "REFERRAL_REQUESTED",
  "REFERRED",
  "NOT_INTERESTED",
  "FOLLOW_UP_DUE",
] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const STATUS_LABELS: Record<string, string> = {
  RESEARCHED: "Researched",
  READY_TO_CONNECT: "Ready to connect",
  REQUEST_SENT: "Request sent",
  ACCEPTED: "Accepted",
  MESSAGE_DRAFTED: "Message drafted",
  MESSAGE_SENT: "Message sent",
  REPLIED: "Replied",
  REFERRAL_REQUESTED: "Referral requested",
  REFERRED: "Referred",
  NOT_INTERESTED: "Not interested",
  FOLLOW_UP_DUE: "Follow-up due",
};

export const PERSONAS = ["ENGINEER", "FULLSTACK", "RECRUITER", "FOUNDER_CXO", "MANAGER", "OTHER"] as const;
export type Persona = (typeof PERSONAS)[number];
export const PERSONA_LABELS: Record<string, string> = {
  ENGINEER: "Engineer",
  FULLSTACK: "Full-stack",
  RECRUITER: "Recruiter",
  FOUNDER_CXO: "Founder / CXO",
  MANAGER: "Manager",
  OTHER: "Other",
};

export const SOURCES = ["MANUAL", "GMAIL", "GITHUB", "IMPORT"] as const;
export const SOURCE_LABELS: Record<string, string> = { MANUAL: "Added by you", GMAIL: "Gmail", GITHUB: "GitHub", IMPORT: "Import" };

export const MESSAGE_TYPES = ["CONNECTION_NOTE", "REFERRAL_ASK", "FOLLOW_UP", "THANK_YOU"] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];
export const MESSAGE_LABELS: Record<string, string> = {
  CONNECTION_NOTE: "Connection note",
  REFERRAL_ASK: "Referral ask",
  FOLLOW_UP: "Follow-up",
  THANK_YOU: "Thank-you",
  CONNECTION_REQUEST: "Connection note",
  REFERRAL_FOLLOWUP: "Referral ask",
  FOLLOWUP_REMINDER: "Follow-up",
};
/** Legacy stored types → current names. */
export function canonicalType(type: string): MessageType | null {
  const map: Record<string, MessageType> = { CONNECTION_REQUEST: "CONNECTION_NOTE", REFERRAL_FOLLOWUP: "REFERRAL_ASK", FOLLOWUP_REMINDER: "FOLLOW_UP" };
  if ((MESSAGE_TYPES as readonly string[]).includes(type)) return type as MessageType;
  return map[type] ?? null;
}

export const SORTS = [
  { value: "priority", label: "Priority" },
  { value: "recent", label: "Recently updated" },
  { value: "company", label: "Company" },
  { value: "followUp", label: "Follow-up due" },
] as const;

export interface PriorityItem {
  label: string;
  points: number;
}

export interface NextAction {
  value: string;
  label: string;
  kind: "status" | "draft";
}

export interface NetworkingMessage {
  id: string;
  contactId: string;
  type: string;
  content: string;
  status: "DRAFT" | "APPROVED" | "SENT" | string;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  name: string;
  company: string;
  companyKey: string;
  role: string;
  headline: string | null;
  team?: string | null;
  linkedinUrl: string | null;
  xUrl: string | null;
  githubUrl: string | null;
  email: string | null;
  emailSource: string | null;
  school: string | null;
  persona: string;
  source: string;
  verified: boolean;
  vitAlumni: boolean;
  status: string;
  effectiveStatus: string;
  followUpDue: boolean;
  noReply: boolean;
  notes: string | null;
  targetJobId: string | null;
  targetJob: { id: string; title: string; company: string; url: string; externalId?: string; isActive?: boolean } | null;
  requestSentAt: string | null;
  acceptedAt: string | null;
  lastContactAt: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  updatedAt: string;
  priority: { score: number; breakdown: PriorityItem[] };
  nextActions: NextAction[];
  applicationStage: string | null;
  messages: NetworkingMessage[];
}

export interface ContactSummary {
  id: string;
  name: string;
  role: string;
  company: string;
  persona: string;
  vitAlumni: boolean;
  status: string;
  effectiveStatus: string;
  linkedinUrl: string | null;
  xUrl: string | null;
  email: string | null;
  priority: number;
  followUpDue: boolean;
}

export interface CompanyPeople {
  count: number;
  alumniCount: number;
  topContacts: ContactSummary[];
}

export interface PeopleLink {
  id: string;
  group: string;
  site: string;
  label: string;
  url: string;
  description: string;
}

export interface GithubPerson {
  login: string;
  name: string | null;
  htmlUrl: string;
  avatarUrl: string | null;
  blog: string | null;
  twitterUsername: string | null;
  company: string | null;
  bio: string | null;
  email: string | null;
  location: string | null;
  via: "member" | "contributor";
  companyMatches: boolean;
  contributions?: number;
  existingContactId: string | null;
}

export interface GithubPeopleResult {
  company: string;
  org: { login: string; name: string | null; htmlUrl: string } | null;
  orgCandidates: { login: string; htmlUrl: string }[];
  people: GithubPerson[];
  source: "members" | "contributors" | "none";
  rateLimited: boolean;
  rateLimitResetAt: string | null;
  message: string | null;
}

export interface JobOption {
  id: string;
  title: string;
  company: string;
  url: string;
  applicationStage: string | null;
}

export type GenerateResponse =
  | {
      needsJobLink: false;
      message: NetworkingMessage;
      content: string;
      type: MessageType;
      usedAi: boolean;
      charCount: number;
      wordCount: number;
      limit: { chars?: number; words?: number };
      job: { id: string; title: string; url: string } | null;
      warnings: string[];
    }
  | { needsJobLink: true; message: null; reason: string; jobOptions: JobOption[] };

export interface Facets {
  total: number;
  alumni: number;
  followUpDue: number;
  status: Record<string, number>;
  persona: Record<string, number>;
  source: Record<string, number>;
  companies: { companyKey: string; company: string; count: number }[];
}
