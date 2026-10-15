export type RunMode = "DRY_RUN" | "LIVE";
export type RunStatus = "STARTING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "STOPPED";

export interface PreflightCheck {
  id: string;
  label: string;
  ok: boolean;
  required: boolean;
  detail: string;
  fix: string;
}

export interface Preflight {
  ok: boolean;
  executor: "local" | "agent";
  checks: PreflightCheck[];
}

export interface WellfoundRun {
  id: string;
  mode: RunMode;
  visible: boolean;
  maxApplications: number;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  logPath: string | null;
  diagnosticsDir: string | null;
  submittedCount: number;
  skippedCount: number;
  errorCount: number;
  error: string | null;
  diagnosticsCount?: number;
}

export interface WellfoundStats {
  todayKey: string;
  today: number;
  dailyCap: number;
  remainingToday: number;
  totalApplications: number;
  csvPath: string;
}

export interface WellfoundOverview {
  stats: WellfoundStats;
  executor: "local" | "agent";
  geminiConfigured: boolean;
  activeRun: WellfoundRun | null;
  lastRun: WellfoundRun | null;
}

export interface WellfoundProfile {
  name: string;
  email: string;
  phone: string;
  location: string;
  school: string;
  currentRole: string;
  company: string;
  education: string;
  yearsOfExperience: string;
  skills: string;
  highlights: string[];
  noticePeriod: string;
  currentCTC: string;
  expectedCTC: string;
  dob: string;
  gender: string;
  workAuth: string;
  github: string;
  linkedin: string;
  portfolio: string;
  x: string;
}

export interface WellfoundRules {
  dailyCap: number;
  autoTickTerms: boolean;
  maxRuntimeMinutes: number;
}

export type FieldSource = "profile" | "legacy-env" | "resume-defaults" | "empty";

export interface WellfoundConfig {
  profile: WellfoundProfile;
  sources: Record<keyof WellfoundProfile, FieldSource>;
  rules: WellfoundRules;
  geminiConfigured: boolean;
  envWritable: boolean;
}

export interface AppliedRow {
  date: string;
  role: string;
  company: string;
  salary?: string;
  skills?: string;
  link?: string;
  submittedAt: string | null;
  istDate: string | null;
  isToday: boolean;
  stage: string | null;
}

export interface DiagnosticArtifact {
  id: string;
  reason: string;
  screenshot: string | null;
  html: string | null;
  json: string | null;
  context: { url?: string; title?: string; at?: string; context?: Record<string, unknown> } | null;
}

export interface DiagnosticsListing {
  runId: string;
  artifacts: DiagnosticArtifact[];
  files: { name: string; size: number }[];
}

export const isActiveStatus = (s: RunStatus | undefined | null) => s === "STARTING" || s === "RUNNING";
