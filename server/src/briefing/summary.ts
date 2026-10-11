import { prisma } from '../db';

export interface BriefingMetrics {
  newApplicationsCount: number;
  interviewsCount: number;
  rejectionsCount: number;
  acceptedConnectionsCount: number;
  needsAttentionCount: number;
}

export interface DailyBriefingPayload {
  date: string;
  metrics: BriefingMetrics;
  content: string;
  needsAttentionItems: string[];
  goodNewsItems: string[];
  topJobs: Array<{ id: string; title: string; company: string; score: number; url: string }>;
}

export class DailyBriefingService {
  /**
   * Generates or fetches today's daily job search summary
   */
  async generateDailyBriefing(targetDate?: Date): Promise<DailyBriefingPayload> {
    const now = targetDate || new Date();
    // Normalize to start of day UTC
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const endOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));

    // 1. Fetch email events from past 24 hours
    const sinceYesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const emailEvents = await prisma.emailEvent.findMany({
      where: {
        receivedAt: { gte: sinceYesterday },
      },
      include: {
        jobApplication: { include: { jobListing: true } },
        networkingContact: true,
      },
      orderBy: { receivedAt: 'desc' },
    });

    // 2. Fetch applications created or updated today
    const activeApplications = await prisma.jobApplication.findMany({
      where: {
        updatedAt: { gte: sinceYesterday },
      },
      include: { jobListing: true },
    });

    // 3. Fetch accepted contacts or contacts needing follow-up
    const dueContacts = await prisma.networkingContact.findMany({
      where: {
        OR: [
          { status: 'ACCEPTED' },
          { nextFollowUpAt: { lte: endOfDay } },
        ],
      },
      include: { messages: true },
    });

    // 4. Fetch top 3 recommended job listings with high scores
    const topJobs = await prisma.jobListing.findMany({
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      take: 3,
      select: { id: true, title: true, company: true, score: true, url: true },
    });

    // Compute metrics
    const interviews = emailEvents.filter(e => e.classification === 'INTERVIEW_INVITATION');
    const assessments = emailEvents.filter(e => e.classification === 'ASSESSMENT');
    const rejections = emailEvents.filter(e => e.classification === 'REJECTION');
    const acceptedConnections = emailEvents.filter(e => e.classification === 'LINKEDIN_CONNECTION_ACCEPTED');
    const newApps = activeApplications.filter(a => a.stage === 'APPLIED' || a.stage === 'APPLYING');

    const needsAttentionItems: string[] = [];
    const goodNewsItems: string[] = [];

    // Urgent attention: Interviews to schedule
    for (const inv of interviews) {
      needsAttentionItems.push(`🚨 **Interview Invitation**: ${inv.company || 'Company'} — ${inv.subject}. Action: Select a calendar slot promptly.`);
    }

    // Urgent attention: Assessments with deadlines
    for (const ass of assessments) {
      needsAttentionItems.push(`📝 **Online Assessment**: ${ass.company || 'Company'} — ${ass.subject}. Action: Prepare and complete coding challenge.`);
    }

    // Follow-ups due in Networking CRM
    for (const contact of dueContacts) {
      if (contact.status === 'ACCEPTED') {
        needsAttentionItems.push(`🤝 **Accepted Connection**: ${contact.name} at ${contact.company} connected! Action: Review and send drafted referral request.`);
      } else if (contact.nextFollowUpAt && contact.nextFollowUpAt <= now) {
        needsAttentionItems.push(`⏳ **Follow-up Due**: Check status of connection request with ${contact.name} (${contact.company}).`);
      }
    }

    // Good news items
    for (const app of newApps) {
      goodNewsItems.push(`🚀 Application tracked for **${app.jobListing.title}** at **${app.jobListing.company}** (Stage: ${app.stage}).`);
    }
    for (const conn of acceptedConnections) {
      goodNewsItems.push(`🎉 LinkedIn connection accepted: ${conn.explanation || conn.subject}.`);
    }

    const needsAttentionCount = needsAttentionItems.length;
    const dateFormatted = now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'Asia/Kolkata',
    });

    // Build Markdown briefing content
    let markdown = `# 📰 Daily Job-Search Executive Briefing\n`;
    markdown += `**Date:** ${dateFormatted} (8:00 PM IST)\n\n`;

    markdown += `## 📊 Executive Snapshot\n`;
    markdown += `- **Action Items Requiring Attention:** ${needsAttentionCount}\n`;
    markdown += `- **Interview Invitations (24h):** ${interviews.length}\n`;
    markdown += `- **Assessments Pending (24h):** ${assessments.length}\n`;
    markdown += `- **Accepted Connections (24h):** ${acceptedConnections.length}\n`;
    markdown += `- **Applications Active / Submitted (24h):** ${newApps.length}\n`;
    markdown += `- **Rejections Recorded (24h):** ${rejections.length}\n\n`;

    markdown += `## 🚨 Needs Attention (${needsAttentionCount})\n`;
    if (needsAttentionItems.length > 0) {
      needsAttentionItems.forEach(item => {
        markdown += `- ${item}\n`;
      });
    } else {
      markdown += `_All clear! No urgent interviews, assessments, or overdue follow-ups pending._\n`;
    }
    markdown += `\n`;

    if (goodNewsItems.length > 0) {
      markdown += `## 🎉 Progress & Updates\n`;
      goodNewsItems.forEach(item => {
        markdown += `- ${item}\n`;
      });
      markdown += `\n`;
    }

    if (topJobs.length > 0) {
      markdown += `## 🎯 Top Recommended Roles Today\n`;
      topJobs.forEach(job => {
        markdown += `- **[${job.title}](${job.url})** at **${job.company}** — Fit Score: **${job.score}/100**\n`;
      });
      markdown += `\n`;
    }

    markdown += `---\n*Generated autonomously by Job-Agent for Shourya Upadhyaya.*`;

    const metrics: BriefingMetrics = {
      newApplicationsCount: newApps.length,
      interviewsCount: interviews.length,
      rejectionsCount: rejections.length,
      acceptedConnectionsCount: acceptedConnections.length,
      needsAttentionCount,
    };

    // Upsert into DailyJobSearchSummary database table
    await prisma.dailyJobSearchSummary.upsert({
      where: { summaryDate: startOfDay },
      update: {
        content: markdown,
        newApplicationsCount: metrics.newApplicationsCount,
        interviewsCount: metrics.interviewsCount,
        rejectionsCount: metrics.rejectionsCount,
        acceptedConnectionsCount: metrics.acceptedConnectionsCount,
        needsAttentionCount: metrics.needsAttentionCount,
        generatedAt: now,
      },
      create: {
        summaryDate: startOfDay,
        timezone: 'Asia/Kolkata',
        content: markdown,
        newApplicationsCount: metrics.newApplicationsCount,
        interviewsCount: metrics.interviewsCount,
        rejectionsCount: metrics.rejectionsCount,
        acceptedConnectionsCount: metrics.acceptedConnectionsCount,
        needsAttentionCount: metrics.needsAttentionCount,
        deliveryStatus: 'GENERATED',
        generatedAt: now,
      },
    });

    return {
      date: dateFormatted,
      metrics,
      content: markdown,
      needsAttentionItems,
      goodNewsItems,
      topJobs,
    };
  }

  /**
   * Retrieves today's summary or past summary by date
   */
  async getSummary(date?: Date) {
    const target = date || new Date();
    const startOfDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), 0, 0, 0));

    let summary = await prisma.dailyJobSearchSummary.findUnique({
      where: { summaryDate: startOfDay },
    });

    if (!summary) {
      await this.generateDailyBriefing(target);
      summary = await prisma.dailyJobSearchSummary.findUnique({
        where: { summaryDate: startOfDay },
      });
    }

    return summary;
  }

  /**
   * Retrieves briefing history
   */
  async getHistory(limit: number = 14) {
    return prisma.dailyJobSearchSummary.findMany({
      orderBy: { summaryDate: 'desc' },
      take: limit,
    });
  }
}

export const dailyBriefingService = new DailyBriefingService();
