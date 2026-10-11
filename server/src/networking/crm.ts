import { prisma } from '../db';

export interface TargetPersona {
  name: string;
  company: string;
  role: string;
  headline?: string;
  team?: string;
  vitAlumni: boolean;
  outreachAngle: string;
  relevanceScore: number;
  searchUrl: string;
}

export interface GeneratedMessage {
  type: 'CONNECTION_REQUEST' | 'REFERRAL_FOLLOWUP';
  content: string;
  charCount: number;
  maxCharLimit?: number;
  isWithinLimit: boolean;
}

export class NetworkingCrmService {
  /**
   * Generates ranked networking target contact suggestions for a given company or job listing
   */
  async generateTargetContactsForCompany(company: string, targetJobId?: string): Promise<TargetPersona[]> {
    const encodedComp = encodeURIComponent(company);

    const personas: TargetPersona[] = [
      {
        name: `Senior Software Engineer (${company})`,
        company,
        role: 'Senior Software Engineer',
        headline: `Senior Software Engineer at ${company} | VIT Vellore Alum`,
        team: 'Backend & Infrastructure',
        vitAlumni: true,
        outreachAngle: 'Shared VIT Vellore alumni network; high empathy for university interns.',
        relevanceScore: 98,
        searchUrl: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(company + ' software engineer VIT Vellore')}`,
      },
      {
        name: `University Recruiter (${company})`,
        company,
        role: 'University Talent Recruiter',
        headline: `Emerging Talent & University Recruiting at ${company}`,
        team: 'Campus Recruiting',
        vitAlumni: false,
        outreachAngle: 'Direct campus recruiter sourcing for Software Engineering Intern 2025/2026.',
        relevanceScore: 90,
        searchUrl: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(company + ' university recruiter campus intern')}`,
      },
      {
        name: `Backend Engineer (${company})`,
        company,
        role: 'Backend / Systems Engineer',
        headline: `Backend Engineer at ${company} | Distributed Systems & APIs`,
        team: 'Core Platform',
        vitAlumni: false,
        outreachAngle: 'Direct peer engineer working in backend stack (Node.js / Go / PostgreSQL).',
        relevanceScore: 88,
        searchUrl: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(company + ' backend engineer platform')}`,
      },
      {
        name: `Engineering Manager (${company})`,
        company,
        role: 'Engineering Manager',
        headline: `Engineering Manager at ${company}`,
        team: 'Product Engineering',
        vitAlumni: false,
        outreachAngle: 'Hiring decision maker with team headcount for engineering interns.',
        relevanceScore: 82,
        searchUrl: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(company + ' engineering manager software')}`,
      },
    ];

    return personas;
  }

  /**
   * Generates a tailored LinkedIn connection request note strictly under the 300 character limit
   */
  generateConnectionNote(contact: {
    name: string;
    company: string;
    role: string;
    vitAlumni?: boolean;
  }): GeneratedMessage {
    const firstName = contact.name.split(' ')[0] || contact.name;
    let note = '';

    if (contact.vitAlumni) {
      note = `Hi ${firstName}, I'm Shourya, CS student at VIT '28 passionate about backend systems. Noticed you're at ${contact.company} working on ${contact.role}. Would love to connect and follow your journey!`;
    } else if (contact.role.toLowerCase().includes('recruiter') || contact.role.toLowerCase().includes('talent')) {
      note = `Hi ${firstName}, I'm Shourya, a CS student at VIT '28 specializing in backend engineering. I'm actively applying for SWE Intern roles at ${contact.company} and would love to connect!`;
    } else if (contact.role.toLowerCase().includes('manager') || contact.role.toLowerCase().includes('lead')) {
      note = `Hi ${firstName}, I've been following ${contact.company}'s engineering architecture. As a backend-focused CS student building high-throughput systems, I'd love to connect!`;
    } else {
      note = `Hi ${firstName}, I'm a CS student at VIT '28 focused on backend systems (Node, Go, Postgres). Really admire ${contact.company}'s engineering work and would love to connect!`;
    }

    // Strict 300 character constraint enforcement
    if (note.length > 300) {
      note = note.slice(0, 297) + '...';
    }

    return {
      type: 'CONNECTION_REQUEST',
      content: note,
      charCount: note.length,
      maxCharLimit: 300,
      isWithinLimit: note.length <= 300,
    };
  }

  /**
   * Generates a personalized referral follow-up message when a connection request has been accepted
   */
  async generateReferralFollowUp(contactId: string): Promise<GeneratedMessage> {
    const contact = await prisma.networkingContact.findUnique({
      where: { id: contactId },
      include: { targetJob: true },
    });

    if (!contact) {
      throw new Error(`Contact ${contactId} not found`);
    }

    const candidate = await prisma.candidateProfile.findFirst();
    const candidateName = candidate?.name || 'Shourya';
    const gradYear = candidate?.targetGradYear || 2028;
    const targetRole = contact.targetJob?.title || 'Software Engineering Intern';
    const firstName = contact.name.split(' ')[0] || contact.name;

    let content = '';

    if (contact.vitAlumni) {
      content = `Hi ${firstName}, thank you for accepting my connection request!

As a fellow VITian (Class of '${gradYear.toString().slice(-2)}' B.Tech CSE), I'm really inspired by your journey to ${contact.company}. I'm currently preparing for ${targetRole} roles and have built high-throughput backend services and data pipelines using Node.js, Go, and PostgreSQL.

I've submitted my application for the ${targetRole} opening at ${contact.company}. If comfortable, would you be open to providing an internal referral, or sharing any advice on what the engineering team values most?

Happy to share my 1-page resume and GitHub whenever convenient. Truly appreciate your time and guidance!`;
    } else if (contact.role.toLowerCase().includes('recruiter') || contact.role.toLowerCase().includes('talent')) {
      content = `Hi ${firstName}, thanks for connecting!

I'm ${candidateName}, a CS student at VIT Vellore ('${gradYear.toString().slice(-2)}') specializing in backend and systems engineering. I recently came across the ${targetRole} role at ${contact.company} and was really excited by the problems your engineering teams are solving.

I've formally applied online. Would you be the best person to speak with regarding campus intern applications, or could you point me to the recruiter overseeing this pipeline? Happy to share my resume and portfolio!`;
    } else {
      content = `Hi ${firstName}, thank you for connecting!

I've been following ${contact.company}'s engineering work closely. As a backend-focused student developer (building distributed systems and API pipelines with TypeScript, Go, and PostgreSQL), I'm applying for the ${targetRole} position.

If you have a quick moment and feel comfortable, would you be open to referring me internally or introducing me to the hiring team? Happy to share my 1-page resume and project links. Thank you for your time!`;
    }

    return {
      type: 'REFERRAL_FOLLOWUP',
      content: content.trim(),
      charCount: content.length,
      isWithinLimit: true,
    };
  }

  /**
   * Transition contact lifecycle stage with timestamps and follow-up reminders
   */
  async transitionStage(
    contactId: string,
    newStage: string,
    notes?: string
  ) {
    const data: any = { status: newStage };
    if (notes) data.notes = notes;

    const now = new Date();

    switch (newStage) {
      case 'REQUEST_SENT':
        data.requestSentAt = now;
        data.lastContactAt = now;
        // Schedule follow-up check in 5 days
        data.nextFollowUpAt = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
        break;
      case 'ACCEPTED':
        data.acceptedAt = now;
        // Next follow-up is due now (to send referral ask)
        data.nextFollowUpAt = now;
        break;
      case 'MESSAGE_SENT':
      case 'REFERRAL_REQUESTED':
        data.lastContactAt = now;
        // Schedule follow-up check in 7 days
        data.nextFollowUpAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        break;
      case 'REPLIED':
      case 'REFERRED':
        data.lastContactAt = now;
        data.nextFollowUpAt = null;
        break;
      default:
        break;
    }

    const updated = await prisma.networkingContact.update({
      where: { id: contactId },
      data,
      include: { messages: true, targetJob: true },
    });

    return updated;
  }
}

export const networkingCrmService = new NetworkingCrmService();
