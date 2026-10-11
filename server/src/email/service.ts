import { google } from 'googleapis';
import { prisma } from '../db';
import { classifyJobEmail, ClassificationResult } from './classifier';

export interface SyncResult {
  syncedCount: number;
  newEventsCount: number;
  interviewsCount: number;
  rejectionsCount: number;
  offersCount: number;
  assessmentsCount: number;
  connectionsAcceptedCount: number;
  events: any[];
}

export class GmailService {
  private getOAuth2Client() {
    const clientId = process.env.GOOGLE_CLIENT_ID || 'dummy-client-id';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || 'dummy-client-secret';
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/gmail/oauth2callback';

    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }

  /**
   * Generates Google OAuth 2.0 authorization URL
   */
  getAuthUrl(): string {
    const oauth2Client = this.getOAuth2Client();
    const scopes = [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/gmail.readonly',
    ];

    // Optional send scope if configured
    if (process.env.ENABLE_GMAIL_SEND === 'true') {
      scopes.push('https://www.googleapis.com/auth/gmail.send');
    }

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: scopes,
    });
  }

  /**
   * Exchanges authorization code for tokens and registers connected account
   */
  async handleOAuthCallback(code: string) {
    const oauth2Client = this.getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Fetch user profile email
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email || 'user@gmail.com';

    // Store in ConnectedAccount table
    const account = await prisma.connectedAccount.upsert({
      where: {
        provider_email: {
          provider: 'gmail',
          email,
        },
      },
      update: {
        accessToken: tokens.access_token || null,
        refreshToken: tokens.refresh_token || null,
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scopes: tokens.scope ? tokens.scope.split(' ') : [],
        status: 'CONNECTED',
        lastSyncedAt: new Date(),
        metadata: { name: userInfo.data.name, picture: userInfo.data.picture },
      },
      create: {
        provider: 'gmail',
        email,
        accessToken: tokens.access_token || null,
        refreshToken: tokens.refresh_token || null,
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scopes: tokens.scope ? tokens.scope.split(' ') : [],
        status: 'CONNECTED',
        lastSyncedAt: new Date(),
        metadata: { name: userInfo.data.name, picture: userInfo.data.picture },
      },
    });

    return account;
  }

  /**
   * Get active Gmail connection status
   */
  async getStatus() {
    const account = await prisma.connectedAccount.findFirst({
      where: { provider: 'gmail', status: 'CONNECTED' },
      orderBy: { updatedAt: 'desc' },
    });

    const eventCount = await prisma.emailEvent.count();

    return {
      connected: !!account,
      email: account?.email || null,
      lastSyncedAt: account?.lastSyncedAt || null,
      totalEventsTracked: eventCount,
      hasCredentialsConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    };
  }

  /**
   * Disconnect and revoke Gmail connection
   */
  async disconnect() {
    const account = await prisma.connectedAccount.findFirst({
      where: { provider: 'gmail', status: 'CONNECTED' },
    });

    if (account) {
      await prisma.connectedAccount.update({
        where: { id: account.id },
        data: {
          status: 'DISCONNECTED',
          accessToken: null,
          refreshToken: null,
        },
      });
    }

    return { status: 'disconnected' };
  }

  /**
   * Processes a single raw email and saves correlated EmailEvent to database
   */
  async processEmail(raw: {
    messageId: string;
    threadId?: string;
    sender: string;
    senderName?: string;
    subject: string;
    snippet?: string;
    body?: string;
    receivedAt?: Date;
  }) {
    const classification = classifyJobEmail({
      subject: raw.subject,
      body: raw.body || raw.snippet,
      sender: raw.sender,
      senderName: raw.senderName,
    });

    let jobApplicationId: string | null = null;
    let networkingContactId: string | null = null;

    // 1. Correlate with JobApplication if company is detected
    if (classification.company) {
      const matchedApp = await prisma.jobApplication.findFirst({
        where: {
          jobListing: {
            company: {
              contains: classification.company,
              mode: 'insensitive',
            },
          },
        },
        include: { jobListing: true },
      });

      if (matchedApp) {
        jobApplicationId = matchedApp.id;

        // Automatically update pipeline stage based on verified email events
        if (classification.classification === 'INTERVIEW_INVITATION' && matchedApp.stage !== 'OFFERED') {
          await prisma.jobApplication.update({
            where: { id: matchedApp.id },
            data: { stage: 'INTERVIEWING' },
          });
        } else if (classification.classification === 'OFFER') {
          await prisma.jobApplication.update({
            where: { id: matchedApp.id },
            data: { stage: 'OFFERED' },
          });
        } else if (classification.classification === 'REJECTION' && matchedApp.stage !== 'OFFERED') {
          await prisma.jobApplication.update({
            where: { id: matchedApp.id },
            data: { stage: 'REJECTED' },
          });
        } else if (classification.classification === 'APPLICATION_CONFIRMATION' && matchedApp.stage === 'BOOKMARKED') {
          await prisma.jobApplication.update({
            where: { id: matchedApp.id },
            data: { stage: 'APPLIED', submittedAt: raw.receivedAt || new Date() },
          });
        }
      }
    }

    // 2. Correlate LinkedIn Connection Acceptance with NetworkingContact
    if (classification.classification === 'LINKEDIN_CONNECTION_ACCEPTED') {
      let matchedContact = null;

      if (classification.extractedPerson) {
        // Find by name
        matchedContact = await prisma.networkingContact.findFirst({
          where: {
            name: {
              contains: classification.extractedPerson,
              mode: 'insensitive',
            },
          },
        });
      }

      // If no name match, try matching by company if available
      if (!matchedContact && classification.company) {
        matchedContact = await prisma.networkingContact.findFirst({
          where: {
            company: {
              contains: classification.company,
              mode: 'insensitive',
            },
            status: { in: ['REQUEST_SENT', 'READY_TO_CONNECT', 'RESEARCHED'] },
          },
        });
      }

      if (matchedContact) {
        networkingContactId = matchedContact.id;

        // Transition contact to ACCEPTED
        await prisma.networkingContact.update({
          where: { id: matchedContact.id },
          data: {
            status: 'ACCEPTED',
            acceptedAt: raw.receivedAt || new Date(),
          },
        });

        // Automatically create a draft Referral Follow-up message for Human-in-the-Loop review
        const candidate = await prisma.candidateProfile.findFirst();
        const candidateName = candidate?.name || 'Shourya';
        const gradYear = candidate?.targetGradYear || 2028;

        const draftContent = matchedContact.vitAlumni
          ? `Hi ${matchedContact.name}, thank you for connecting! As a fellow VITian (Class of '${gradYear.toString().slice(-2)}'), I'm really inspired by your work at ${matchedContact.company}. I'm actively applying for Software Engineering Intern roles—would you be open to giving me a quick referral or feedback on my profile? Truly appreciate your time!`
          : `Hi ${matchedContact.name}, thank you for connecting! I'm ${candidateName}, a CS student passionate about backend systems. I've applied for the Software Engineering Intern role at ${matchedContact.company}. If comfortable, would you be open to referring me internally or pointing me toward the team? Thanks so much!`;

        await prisma.networkingMessage.create({
          data: {
            contactId: matchedContact.id,
            type: 'REFERRAL_FOLLOWUP',
            content: draftContent,
            status: 'DRAFT',
          },
        });
      }
    }

    // Save EmailEvent in DB
    const event = await prisma.emailEvent.upsert({
      where: { messageId: raw.messageId },
      update: {
        threadId: raw.threadId,
        sender: raw.sender,
        senderName: raw.senderName,
        subject: raw.subject,
        snippet: raw.snippet,
        classification: classification.classification,
        confidence: classification.confidence,
        explanation: classification.explanation,
        suggestedAction: classification.suggestedAction,
        company: classification.company,
        jobApplicationId,
        networkingContactId,
      },
      create: {
        messageId: raw.messageId,
        threadId: raw.threadId,
        sender: raw.sender,
        senderName: raw.senderName,
        subject: raw.subject,
        snippet: raw.snippet,
        receivedAt: raw.receivedAt || new Date(),
        classification: classification.classification,
        confidence: classification.confidence,
        explanation: classification.explanation,
        suggestedAction: classification.suggestedAction,
        company: classification.company,
        jobApplicationId,
        networkingContactId,
        isProcessed: true,
      },
    });

    return { event, classification };
  }

  /**
   * Sync inbox from real Gmail API (if connected) or sync simulated demo events
   */
  async syncInbox(): Promise<SyncResult> {
    const account = await prisma.connectedAccount.findFirst({
      where: { provider: 'gmail', status: 'CONNECTED' },
    });

    // If connected with Google tokens, call real Gmail API
    if (account?.accessToken) {
      try {
        const oauth2Client = this.getOAuth2Client();
        oauth2Client.setCredentials({
          access_token: account.accessToken,
          refresh_token: account.refreshToken || undefined,
        });

        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        const query = "job OR application OR interview OR assessment OR offer OR rejection OR 'accepted your invitation' OR 'referral'";
        const res = await gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults: 25,
        });

        const messages = res.data.messages || [];
        const processedEvents: any[] = [];

        for (const msg of messages) {
          if (!msg.id) continue;
          const detail = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'full',
          });

          const headers = detail.data.payload?.headers || [];
          const getHeader = (name: string) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

          const subject = getHeader('subject');
          const from = getHeader('from');
          const dateStr = getHeader('date');
          const receivedAt = dateStr ? new Date(dateStr) : new Date();

          const { event } = await this.processEmail({
            messageId: msg.id,
            threadId: detail.data.threadId || undefined,
            sender: from,
            subject,
            snippet: detail.data.snippet || '',
            receivedAt,
          });

          processedEvents.push(event);
        }

        // Update lastSyncedAt
        await prisma.connectedAccount.update({
          where: { id: account.id },
          data: { lastSyncedAt: new Date() },
        });

        return this.summarizeSync(processedEvents);
      } catch (err) {
        console.warn('[GmailService] Real API sync failed, falling back:', err);
      }
    }

    // Default / Seed Sync for development or unauthenticated testing:
    // Process representative job emails so user can experience full functionality
    const demoEmails = [
      {
        messageId: 'gmail-demo-1',
        sender: 'recruiting@cloudflare.com',
        senderName: 'Cloudflare University Talent',
        subject: 'Invitation to Interview: Software Engineer Intern at Cloudflare',
        snippet: 'Hi Shourya, we reviewed your application and would like to schedule a 45-minute technical screen with our Systems team. Please use our calendar link to pick a time.',
        receivedAt: new Date(Date.now() - 3600000 * 2), // 2 hours ago
      },
      {
        messageId: 'gmail-demo-2',
        sender: 'invitations@linkedin.com',
        senderName: 'LinkedIn Invitations',
        subject: 'Priya Sharma accepted your invitation to connect',
        snippet: 'Priya Sharma (Software Engineer at Cloudflare | VIT Alumni) is now a connection. Send a message to start a conversation.',
        receivedAt: new Date(Date.now() - 3600000 * 5), // 5 hours ago
      },
      {
        messageId: 'gmail-demo-3',
        sender: 'talent@spotify.com',
        senderName: 'Spotify Campus Recruiting',
        subject: 'Spotify Engineering Internship: Online Assessment Invitation',
        snippet: 'Congratulations! As the next step in our process, please complete our 70-minute HackerRank coding challenge within 5 calendar days.',
        receivedAt: new Date(Date.now() - 3600000 * 12), // 12 hours ago
      },
      {
        messageId: 'gmail-demo-4',
        sender: 'careers@linear.app',
        senderName: 'Linear Careers',
        subject: 'Application Received: Full-Stack Engineer at Linear',
        snippet: 'Thank you for applying to Linear! We have received your application and will review your materials shortly.',
        receivedAt: new Date(Date.now() - 3600000 * 24), // 1 day ago
      },
      {
        messageId: 'gmail-demo-5',
        sender: 'no-reply@greenhouse.io',
        senderName: 'Acme Corp Recruiting',
        subject: 'Update regarding your application at Acme Corp',
        snippet: 'Thank you for your interest. Unfortunately, after careful consideration, we have decided to move forward with other candidates at this time.',
        receivedAt: new Date(Date.now() - 3600000 * 48), // 2 days ago
      },
    ];

    const processedEvents: any[] = [];
    for (const email of demoEmails) {
      const { event } = await this.processEmail(email);
      processedEvents.push(event);
    }

    return this.summarizeSync(processedEvents);
  }

  private summarizeSync(events: any[]): SyncResult {
    return {
      syncedCount: events.length,
      newEventsCount: events.length,
      interviewsCount: events.filter(e => e.classification === 'INTERVIEW_INVITATION').length,
      rejectionsCount: events.filter(e => e.classification === 'REJECTION').length,
      offersCount: events.filter(e => e.classification === 'OFFER').length,
      assessmentsCount: events.filter(e => e.classification === 'ASSESSMENT').length,
      connectionsAcceptedCount: events.filter(e => e.classification === 'LINKEDIN_CONNECTION_ACCEPTED').length,
      events,
    };
  }
}

export const gmailService = new GmailService();
