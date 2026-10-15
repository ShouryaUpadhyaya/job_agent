import { classifyJobEmail, ComprehensiveClassification, ClassificationResult } from './classifier';

/** Legacy three-way wrapper kept for older callers/tests; prefer classifyJobEmail. */
export type EmailClassification = "INTERVIEW" | "REJECTION" | "UNKNOWN";

export function classifyEmail(content: string): EmailClassification {
  const result = classifyJobEmail({ subject: content, body: content });
  if (result.classification === "INTERVIEW_INVITATION") {
    return "INTERVIEW";
  }
  if (result.classification === "REJECTION") {
    return "REJECTION";
  }
  return "UNKNOWN";
}

export { classifyJobEmail };
export type { ComprehensiveClassification, ClassificationResult };
