/**
 * One-off maintenance: fills `companyKey` (and `isInternship`) on rows created before
 * those columns existed. Safe to re-run. Dry run by default, like the other maintenance scripts.
 *   npx tsx src/scripts/backfillCompanyKeys.ts           # report only
 *   npx tsx src/scripts/backfillCompanyKeys.ts --apply   # write
 */
import { prisma } from '../db';
import { companyKey } from '../lib/company';

const INTERNSHIP_RE = /\b(intern|internship|interns|trainee|apprentice)\b/i;
const APPLY = process.argv.includes('--apply');

async function main() {
  const jobs = await prisma.jobListing.findMany({ select: { id: true, company: true, title: true } });
  const apps = await prisma.jobApplication.findMany({ select: { id: true, jobListing: { select: { company: true } } } });
  const contacts = await prisma.networkingContact.findMany({ select: { id: true, company: true } });

  if (!APPLY) {
    console.log(`Dry run: would backfill ${jobs.length} jobs, ${apps.length} applications, ${contacts.length} contacts. Pass --apply to write.`);
    return;
  }

  for (const j of jobs) {
    await prisma.jobListing.update({
      where: { id: j.id },
      data: { companyKey: companyKey(j.company), isInternship: INTERNSHIP_RE.test(j.title) },
    });
  }

  for (const a of apps) {
    await prisma.jobApplication.update({ where: { id: a.id }, data: { companyKey: companyKey(a.jobListing.company) } });
  }

  for (const c of contacts) {
    await prisma.networkingContact.update({ where: { id: c.id }, data: { companyKey: companyKey(c.company) } });
  }

  console.log(`Backfilled ${jobs.length} jobs, ${apps.length} applications, ${contacts.length} contacts.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
