/**
 * Demo emails: written only by the explicit "Load demo events" action, flagged isDemo=true,
 * never linked to applications/contacts and excluded from lists and summaries by default.
 */

/** Message ids the pre-fix service inserted into real databases when a sync failed. */
export const LEGACY_DEMO_MESSAGE_IDS = ['gmail-demo-1', 'gmail-demo-2', 'gmail-demo-3', 'gmail-demo-4', 'gmail-demo-5'];
/** Prefix used by the old /gmail/simulate endpoint (those events did run side effects). */
export const LEGACY_SIMULATED_PREFIX = 'simulated-';
export const DEMO_PREFIX = 'demo-';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

export function demoEmails() {
  return [
    {
      messageId: `${DEMO_PREFIX}interview`,
      sender: 'recruiting@example-cloud.test',
      senderName: 'Example Cloud University Recruiting',
      subject: '[Demo] Invitation to interview: Software Engineer Intern at Example Cloud',
      body: 'Hi, we reviewed your application and would like to schedule a 45-minute technical interview. Please pick a time on our calendar by Oct 20.',
      receivedAt: hoursAgo(2),
    },
    {
      messageId: `${DEMO_PREFIX}assessment`,
      sender: 'support@hackerrankforwork.com',
      senderName: 'HackerRank',
      subject: '[Demo] Demo Labs has invited you to take a coding test',
      body: 'Demo Labs has invited you to complete the online assessment for the Backend Intern role. Please complete it within 72 hours.',
      receivedAt: hoursAgo(8),
    },
    {
      messageId: `${DEMO_PREFIX}confirmation`,
      sender: 'no-reply@us.greenhouse-mail.io',
      senderName: 'Sample Fintech',
      subject: '[Demo] Thank you for applying to Sample Fintech',
      body: 'Thank you for applying for the SDE Intern role at Sample Fintech. Our team will review your application.',
      receivedAt: hoursAgo(26),
    },
    {
      messageId: `${DEMO_PREFIX}rejection`,
      sender: 'no-reply@hire.lever.co',
      senderName: 'Placeholder Inc',
      subject: '[Demo] Update on your application to Placeholder Inc',
      body: 'Thank you for your interest. Unfortunately, we have decided to move forward with other candidates at this time.',
      receivedAt: hoursAgo(50),
    },
  ];
}
