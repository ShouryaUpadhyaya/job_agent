/**
 * Gmail search query for incremental sync: messages after a cursor that come from ATS,
 * assessment or job-site senders, or whose subject has a job-search phrase.
 */

export const SENDER_FILTERS = [
  'greenhouse.io',
  'greenhouse-mail.io',
  'lever.co',
  'hire.lever.co',
  'myworkday.com',
  'myworkdayjobs.com',
  'ashbyhq.com',
  'smartrecruiters.com',
  'workablemail.com',
  'workable.com',
  'icims.com',
  'jobvite.com',
  'naukri.com',
  'internshala.com',
  'wellfound.com',
  'angel.co',
  'instahyre.com',
  'hackerrank.com',
  'hackerrankforwork.com',
  'hackerearth.com',
  'codesignal.com',
  'mettl.com',
  'mercer-mettl.com',
  'unstop.com',
  'cutshort.io',
  'jobs-noreply@linkedin.com',
  'jobalerts-noreply@linkedin.com',
  'invitations@linkedin.com',
  'invitations-noreply@linkedin.com',
  'messages-noreply@linkedin.com',
  'inmail-hit-reply@linkedin.com',
];

export const SUBJECT_PHRASES = [
  'thank you for applying',
  'thanks for applying',
  'application received',
  'your application',
  'application submitted',
  'interview',
  'assessment',
  'coding challenge',
  'online test',
  'next steps',
  'offer',
  'referral',
  'accepted your invitation',
  'opportunity at',
  'job alert',
];

export function buildGmailQuery(after: Date): string {
  const epoch = Math.floor(after.getTime() / 1000);
  const from = SENDER_FILTERS.join(' OR ');
  const subject = SUBJECT_PHRASES.map((p) => `"${p}"`).join(' OR ');
  return `after:${epoch} -from:me (from:(${from}) OR subject:(${subject}))`;
}
