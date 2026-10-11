export type ComprehensiveClassification =
  | "APPLICATION_CONFIRMATION"
  | "APPLICATION_UPDATE"
  | "INTERVIEW_INVITATION"
  | "ASSESSMENT"
  | "REJECTION"
  | "OFFER"
  | "RECRUITER_OUTREACH"
  | "REFERRAL_RESPONSE"
  | "LINKEDIN_CONNECTION_ACCEPTED"
  | "FOLLOW_UP_REQUIRED"
  | "JOB_ALERT"
  | "UNRELATED"
  | "UNKNOWN";

export interface ClassificationResult {
  classification: ComprehensiveClassification;
  confidence: number;
  explanation: string;
  suggestedAction: string;
  company?: string;
  role?: string;
  extractedPerson?: string;
}

export interface EmailMetadataInput {
  subject: string;
  body?: string;
  sender?: string;
  senderName?: string;
}

/**
 * Extracts candidate/company context from sender email domain or subject
 */
function extractCompany(subject: string, sender?: string): string | undefined {
  if (sender) {
    // Check known domains: noreply@greenhouse.io, notifications@ashbyhq.com, etc.
    const domainMatch = sender.match(/@([a-zA-Z0-9.-]+)\.([a-zA-Z]{2,})/);
    if (domainMatch) {
      const domain = domainMatch[1].toLowerCase();
      // Filter out generic providers
      const generic = ['gmail', 'yahoo', 'outlook', 'hotmail', 'linkedin', 'greenhouse', 'ashbyhq', 'lever', 'workday', 'smartrecruiters', 'icims'];
      if (!generic.includes(domain)) {
        return domain.charAt(0).toUpperCase() + domain.slice(1);
      }
    }
  }

  // Check subject: "Application received for [Company]", "Update on your [Company] application", "[Company] Interview"
  const patterns = [
    /(?:at|for|with)\s+([A-Z][a-zA-Z0-9&.-]+(?:\s+[A-Z][a-zA-Z0-9&.-]+)?)/,
    /\[([A-Z][a-zA-Z0-9&.-]+)\]/,
    /^([A-Z][a-zA-Z0-9&.-]+)\s*[-:|]/,
  ];

  for (const regex of patterns) {
    const match = subject.match(regex);
    if (match && match[1]) {
      const candidate = match[1].trim();
      const skipWords = ['Interview', 'Application', 'Update', 'Offer', 'Invitation', 'Your', 'Software', 'Engineer', 'Intern'];
      if (!skipWords.includes(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

/**
 * Extracts person name from LinkedIn notifications
 * e.g. "Jane Doe accepted your invitation to connect"
 */
function extractLinkedInPerson(subject: string, body?: string): string | undefined {
  const match = subject.match(/(.+?)\s+accepted your invitation to connect/i) ||
                subject.match(/(.+?)\s+accepted your connection request/i) ||
                subject.match(/(.+?)\s+is now a connection/i);
  if (match && match[1]) {
    return match[1].trim();
  }

  if (body) {
    const bodyMatch = body.match(/(.+?)\s+accepted your invitation to connect/i);
    if (bodyMatch && bodyMatch[1]) {
      return bodyMatch[1].trim();
    }
  }

  return undefined;
}

/**
 * Comprehensive classifier for job search and networking emails
 */
export function classifyJobEmail(input: EmailMetadataInput): ClassificationResult {
  const subject = input.subject || '';
  const body = input.body || '';
  const sender = (input.sender || '').toLowerCase();
  const text = `${subject}\n${body}`.toLowerCase();
  const company = extractCompany(subject, input.sender);

  // 1. LinkedIn Connection Acceptance
  const isLinkedInSender = sender.includes('linkedin.com');
  const isConnectionAccepted =
    text.includes('accepted your invitation to connect') ||
    text.includes('accepted your connection request') ||
    text.includes('is now a connection');

  if (isLinkedInSender && isConnectionAccepted) {
    const person = extractLinkedInPerson(subject, body);
    return {
      classification: "LINKEDIN_CONNECTION_ACCEPTED",
      confidence: 0.98,
      explanation: `LinkedIn connection accepted by ${person || 'contact'}`,
      suggestedAction: "Review contact in Networking CRM and draft tailored referral follow-up note.",
      company,
      extractedPerson: person,
    };
  }

  // 2. Offer of Employment
  if (
    text.includes('offer of employment') ||
    text.includes('job offer') ||
    text.includes('pleased to offer you the position') ||
    text.includes('congratulations on your offer') ||
    (text.includes('offer letter') && (text.includes('attached') || text.includes('review your offer')))
  ) {
    return {
      classification: "OFFER",
      confidence: 0.95,
      explanation: "Official employment offer detected.",
      suggestedAction: "Review offer compensation, terms, and deadline; mark application as OFFERED.",
      company,
    };
  }

  // 3. Online Assessment / Coding Challenge
  if (
    text.includes('hackerrank') ||
    text.includes('codesignal') ||
    text.includes('codility') ||
    text.includes('take-home') ||
    text.includes('coding challenge') ||
    text.includes('online assessment') ||
    text.includes('technical assessment') ||
    text.includes('complete the assessment within')
  ) {
    return {
      classification: "ASSESSMENT",
      confidence: 0.94,
      explanation: "Automated or take-home technical coding assessment.",
      suggestedAction: "Review assessment duration and deadline; prepare practice problems before starting.",
      company,
    };
  }

  // 4. Interview Invitation
  if (
    text.includes('interview') ||
    text.includes('schedule a call') ||
    text.includes('phone screen') ||
    text.includes('availability for') ||
    text.includes('next steps') ||
    text.includes('next step') ||
    text.includes('calendar to pick a time') ||
    text.includes('calendly.com') ||
    text.includes('interview with') ||
    text.includes('technical discussion')
  ) {
    // Exclude rejection mentioning interview in past tense
    if (
      !text.includes('unfortunately') &&
      !text.includes('not moving forward') &&
      !text.includes('other candidates')
    ) {
      return {
        classification: "INTERVIEW_INVITATION",
        confidence: 0.92,
        explanation: "Recruiter or hiring manager invitation for interview or screening.",
        suggestedAction: "Select an interview slot promptly and review company technical stack.",
        company,
      };
    }
  }

  // 5. Rejection
  if (
    text.includes('unfortunately') ||
    text.includes('not moving forward') ||
    text.includes('other candidates') ||
    text.includes('pursuing other applicants') ||
    text.includes('will not be moving forward') ||
    text.includes('decided not to proceed') ||
    text.includes('we will not be advancing') ||
    text.includes('not selected for')
  ) {
    return {
      classification: "REJECTION",
      confidence: 0.95,
      explanation: "Application rejection notification.",
      suggestedAction: "Update application status to REJECTED; archive or note feedback.",
      company,
    };
  }

  // 6. Referral Response
  if (
    text.includes('submitted a referral') ||
    text.includes('referred you for') ||
    text.includes('happy to refer you') ||
    text.includes('internal referral')
  ) {
    return {
      classification: "REFERRAL_RESPONSE",
      confidence: 0.90,
      explanation: "Referral confirmation or positive response from employee.",
      suggestedAction: "Thank referrer and follow up with candidate link.",
      company,
    };
  }

  // 7. Recruiter Outreach
  if (
    (text.includes('impressed by your background') ||
     text.includes('came across your profile') ||
     text.includes('thought you might be a fit') ||
     text.includes('reaching out regarding')) &&
    !text.includes('thank you for applying')
  ) {
    return {
      classification: "RECRUITER_OUTREACH",
      confidence: 0.88,
      explanation: "Inbound recruiter outreach or sourcing inquiry.",
      suggestedAction: "Reply within 24 hours with candidate profile and resume.",
      company,
    };
  }

  // 8. Application Confirmation
  if (
    text.includes('thank you for applying') ||
    text.includes('received your application') ||
    text.includes('application has been received') ||
    text.includes('successfully submitted your application') ||
    text.includes('we have received your submission')
  ) {
    return {
      classification: "APPLICATION_CONFIRMATION",
      confidence: 0.95,
      explanation: "Confirmation that job application was successfully submitted.",
      suggestedAction: "Mark application as APPLIED in pipeline.",
      company,
    };
  }

  // 9. Job Alerts / Digests
  if (
    text.includes('new jobs matching your search') ||
    text.includes('job alert') ||
    text.includes('weekly job digest')
  ) {
    return {
      classification: "JOB_ALERT",
      confidence: 0.85,
      explanation: "Automated job listing alert or digest.",
      suggestedAction: "Review suggested job listings for ingestion.",
      company,
    };
  }

  return {
    classification: "UNKNOWN",
    confidence: 0.30,
    explanation: "Unclassified email message.",
    suggestedAction: "Manually review email content if relevant.",
    company,
  };
}
