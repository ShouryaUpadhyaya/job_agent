export type Education = {
  institution?: string;
  degree?: string;
  startYear?: number;
  graduationYear?: number;
  gpa?: string;
};

export type ExperienceEntry = {
  kind?: "work" | "project";
  role?: string;
  company?: string;
  dates?: string;
  bullets?: string[];
};

export type ResumeSummary = {
  id: string;
  label: string;
  targetCategory?: string | null;
  isDefault: boolean;
  skills: string[];
};

export type CandidateProfile = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  school?: string | null;
  targetRole?: string | null;
  targetGradYear?: number | null;
  githubUrl?: string | null;
  linkedinUrl?: string | null;
  portfolioUrl?: string | null;
  xUrl?: string | null;
  preferredLocations?: string[];
  remoteOk?: boolean;
  skills: string[];
  education?: Education | null;
  experience?: ExperienceEntry[] | unknown;
  applicationAnswers?: Record<string, unknown> | null;
  resumes?: ResumeSummary[];
};

export type Resume = {
  id: string;
  label: string;
  targetCategory: string | null;
  content: string;
  skills: string[];
  fileName: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  bestForCount: number;
};

export type RescoreStatus = {
  running: boolean;
  lastFinishedAt: string | null;
  lastRescored: number | null;
  lastError: string | null;
};

export type RescoreOutcome = { status: "done"; rescored: number | null; error: string | null } | { status: "running" };

export function rescoreText(r?: RescoreOutcome | null): string {
  if (!r) return "";
  if (r.status === "running") return " Rescoring jobs in the background…";
  if (r.error) return ` Rescoring failed: ${r.error}`;
  return r.rescored != null ? ` Rescored ${r.rescored} jobs.` : "";
}

/** Application answers the profile form edits (keys shared with the Wellfound runner config). */
export const ANSWER_FIELDS: { key: string; label: string; placeholder?: string; options?: string[] }[] = [
  { key: "noticePeriod", label: "Notice period", placeholder: "Immediate / 2 weeks" },
  { key: "startDate", label: "Earliest start date", placeholder: "May 2027" },
  { key: "expectedStipend", label: "Expected stipend (internships)", placeholder: "₹40,000 / month" },
  { key: "expectedCTC", label: "Expected CTC", placeholder: "₹12 LPA" },
  { key: "currentCTC", label: "Current CTC", placeholder: "0 (student)" },
  { key: "workAuth", label: "Work authorization", placeholder: "Indian citizen; no visa sponsorship needed" },
  { key: "relocation", label: "Open to relocation", options: ["", "Yes", "No", "Within India"] },
  { key: "gender", label: "Gender (optional)", options: ["", "Male", "Female", "Non-binary", "Other"] },
  { key: "yearsOfExperience", label: "Years of experience", placeholder: "0" },
  { key: "currentRole", label: "Current role", placeholder: "Student" },
  { key: "company", label: "Current company", placeholder: "" },
  { key: "dob", label: "Date of birth", placeholder: "YYYY-MM-DD" },
];
