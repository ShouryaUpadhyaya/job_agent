/**
 * Optional Gemini second opinion for emails the rules could not classify confidently.
 * Only runs when GEMINI_KEY is set; the model must return strict JSON whose classification is
 * one of CLASSIFICATIONS, otherwise the rule-based result stands.
 */
import { generateText, isGeminiConfigured, untrusted, UNTRUSTED_NOTICE } from '../lib/gemini';
import {
  CLASSIFICATIONS,
  ClassificationResult,
  importanceFor,
  isClassification,
  suggestedActionFor,
} from './classifier';

export const REFINE_BELOW = 0.6;

export interface RefineInput {
  subject: string;
  sender: string;
  body: string;
}

export function buildRefinePrompt(input: RefineInput): string {
  return [
    'You classify emails from a job seeker\'s inbox.',
    UNTRUSTED_NOTICE,
    `Allowed classifications: ${CLASSIFICATIONS.join(', ')}.`,
    'Definitions: APPLICATION_CONFIRMATION = an application was received; ASSESSMENT = invitation to an online/take-home test;',
    'INTERVIEW_INVITATION = asks to schedule or attend an interview; REJECTION = not moving forward; OFFER = job/internship offer;',
    'RECRUITER_OUTREACH = a recruiter reaching out about a role; REFERRAL_RESPONSE = reply about a referral;',
    'LINKEDIN_CONNECTION_ACCEPTED = LinkedIn connection accepted; FOLLOW_UP_REQUIRED = the sender awaits a reply/action;',
    'JOB_ALERT = automated job listing digest; UNRELATED = not about the job search; UNKNOWN = cannot tell.',
    'Reply with ONLY a JSON object, no markdown: {"classification": "...", "company": string|null, "role": string|null, "confidence": number between 0 and 1}.',
    'company is the hiring company (never an ATS or job board like Greenhouse, Lever, Workday, LinkedIn, Naukri).',
    untrusted('email', `From: ${input.sender}\nSubject: ${input.subject}\n\n${input.body}`, 4000),
  ].join('\n');
}

export function parseRefineResponse(raw: string | null): { classification: ClassificationResult['classification']; company: string | null; role: string | null; confidence: number } | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    if (!isClassification(obj?.classification)) return null;
    const conf = typeof obj.confidence === 'number' && obj.confidence >= 0 && obj.confidence <= 1 ? obj.confidence : 0.6;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() && v.trim().length <= 80 ? v.trim() : null);
    return { classification: obj.classification, company: str(obj.company), role: str(obj.role), confidence: conf };
  } catch {
    return null;
  }
}

/** Returns a refined result, or the original when Gemini is off/unsure/invalid. */
export async function refineWithGemini(base: ClassificationResult, input: RefineInput): Promise<ClassificationResult> {
  if (!isGeminiConfigured() || base.confidence >= REFINE_BELOW) return base;
  const parsed = parseRefineResponse(await generateText(buildRefinePrompt(input), { temperature: 0, timeoutMs: 15000 }));
  if (!parsed || parsed.classification === 'UNKNOWN') return base;
  // AI labels never reach the confidence needed for automatic stage changes on their own.
  const confidence = Math.min(0.75, Math.max(base.confidence, parsed.confidence));
  const deadline = base.deadline;
  return {
    ...base,
    classification: parsed.classification,
    confidence,
    importance: importanceFor(parsed.classification),
    company: base.company || parsed.company || undefined,
    role: base.role || parsed.role || undefined,
    explanation: `Classified by Gemini (rules were unsure).${deadline ? ` Deadline: ${deadline}.` : ''}`,
    suggestedAction: suggestedActionFor(parsed.classification, deadline),
  };
}
