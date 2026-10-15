/**
 * Removes demo email events:
 *   - rows flagged isDemo (Load demo events / the test-email form)
 *   - the five "gmail-demo-N" events the old Gmail service inserted when a real sync failed
 *   - "simulated-…" events from the old /gmail/simulate endpoint
 * The old demo/simulated events also changed application stages and contact statuses; those
 * changes are listed (not reverted) so you can fix them by hand in the Pipeline/Networking tabs.
 *
 * Dry run (default):  npx tsx src/scripts/cleanupDemoEmails.ts
 * Apply:              npx tsx src/scripts/cleanupDemoEmails.ts --apply
 * Take a pg_dump backup first.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { LEGACY_DEMO_MESSAGE_IDS, LEGACY_SIMULATED_PREFIX, DEMO_PREFIX } from '../email/demo';

export const DEMO_EVENT_WHERE: Prisma.EmailEventWhereInput = {
  OR: [
    { isDemo: true },
    { messageId: { in: LEGACY_DEMO_MESSAGE_IDS } },
    { messageId: { startsWith: LEGACY_SIMULATED_PREFIX } },
    { messageId: { startsWith: DEMO_PREFIX } },
  ],
};

export async function findDemoEvents() {
  return prisma.emailEvent.findMany({
    where: DEMO_EVENT_WHERE,
    orderBy: { receivedAt: 'asc' },
    select: {
      id: true,
      messageId: true,
      isDemo: true,
      subject: true,
      classification: true,
      jobApplication: { select: { id: true, stage: true, jobListing: { select: { company: true, title: true } } } },
      networkingContact: { select: { id: true, name: true, company: true, status: true } },
    },
  });
}

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? 'Mode: APPLY (changes will be written)' : 'Mode: DRY RUN (pass --apply to write changes)');

  const events = await findDemoEvents();
  const legacy = events.filter((e) => !e.isDemo);
  for (const e of events) {
    const links = [
      e.jobApplication ? `application ${e.jobApplication.jobListing.company} / ${e.jobApplication.jobListing.title} (now ${e.jobApplication.stage})` : null,
      e.networkingContact ? `contact ${e.networkingContact.name} @ ${e.networkingContact.company} (now ${e.networkingContact.status})` : null,
    ].filter(Boolean);
    console.log(`  delete  ${e.messageId}  ${e.classification}  "${e.subject.slice(0, 70)}"${links.length ? `  linked: ${links.join('; ')}` : ''}`);
  }
  const touched = legacy.filter((e) => e.jobApplication || e.networkingContact);
  console.log(`\nFound ${events.length} demo event(s): ${events.length - legacy.length} flagged isDemo, ${legacy.length} legacy demo/simulated.`);
  if (touched.length) {
    console.log(`${touched.length} legacy event(s) were linked to real records; their stage/status changes are NOT reverted. Review them above.`);
  }

  if (!apply) {
    console.log('Dry run: nothing deleted.');
    return;
  }
  const res = await prisma.emailEvent.deleteMany({ where: { id: { in: events.map((e) => e.id) } } });
  console.log(`Deleted ${res.count} email event(s).`);
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
