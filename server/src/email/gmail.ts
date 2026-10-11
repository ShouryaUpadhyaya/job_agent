export type EmailClassification = "INTERVIEW" | "REJECTION" | "UNKNOWN";

export function classifyEmail(content: string): EmailClassification {
  const lowerContent = content.toLowerCase();
  
  if (
    lowerContent.includes("interview") ||
    lowerContent.includes("scheduling") ||
    lowerContent.includes("next step")
  ) {
    return "INTERVIEW";
  }
  
  if (
    lowerContent.includes("unfortunately") ||
    lowerContent.includes("other candidates") ||
    lowerContent.includes("not moving forward")
  ) {
    return "REJECTION";
  }
  
  return "UNKNOWN";
}
