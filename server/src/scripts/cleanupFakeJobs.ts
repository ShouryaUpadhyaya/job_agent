/**
 * Removes fabricated job listings left by earlier versions:
 *   - Wellfound connector mocks   (externalId 'wf-startup-*', source 'wellfound')
 *   - LinkedIn connector fallbacks (externalId 'li-mock-*',   source 'linkedin')
 *   - seed.ts fictional jobs       (exact externalId + source pairs below)
 * Listings that have applications are left alone and printed so you can decide.
 * Also renames legacy capitalised source values ('Greenhouse' → 'greenhouse') when no
 * canonical row with the same externalId exists.
 *
 * Dry run (default):  npx tsx src/scripts/cleanupFakeJobs.ts
 * Apply:              npx tsx src/scripts/cleanupFakeJobs.ts --apply
 * Take a pg_dump backup first.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { LEGACY_SOURCE_NAMES } from '../connectors/types';

/** Jobs created by the old seed.ts (fictional; URLs never pointed at real postings). */
export const SEEDED_FAKE_JOBS: { externalId: string; source: string }[] = [
  { externalId: 'job-stripe-2027-backend', source: 'Stripe Careers (JSON Feed)' },
  { externalId: 'job-zepto-2027-fullstack', source: 'Zepto Campus Engineering' },
  { externalId: 'job-postman-2027-devinfra', source: 'Postman Developer Platform' },
  { externalId: 'job-razorpay-2027-swe', source: 'Razorpay Jobs RSS' },
  { externalId: 'job-atlassian-2027-cloud', source: 'Atlassian Global RSS' },
  { externalId: 'job-legacy-mainframe-2027', source: 'Legacy Corp Board' },
];

export const FAKE_JOB_WHERE: Prisma.JobListingWhereInput = {
  OR: [
    { externalId: { startsWith: 'wf-startup-' }, source: { equals: 'wellfound', mode: 'insensitive' } },
    { externalId: { startsWith: 'li-mock-' }, source: { equals: 'linkedin', mode: 'insensitive' } },
    ...SEEDED_FAKE_JOBS.map((j) => ({ externalId: j.externalId, source: j.source })),
  ],
};

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? 'Mode: APPLY (changes will be written)' : 'Mode: DRY RUN (pass --apply to write changes)');

  const fakes = await prisma.jobListing.findMany({
    where: FAKE_JOB_WHERE,
    include: { _count: { select: { applications: true } } },
    orderBy: { externalId: 'asc' },
  });
  const deletable = fakes.filter((j) => j._count.applications === 0);
  const kept = fakes.filter((j) => j._count.applications > 0);

  console.log(`\nFake listings found: ${fakes.length}`);
  for (const j of deletable) console.log(`  delete  [${j.source}] ${j.externalId}  ${j.title} @ ${j.company}`);
  for (const j of kept) {
    console.log(`  KEEP    [${j.source}] ${j.externalId}  ${j.title} @ ${j.company}  (${j._count.applications} application(s) — review manually)`);
  }

  // Legacy source names → canonical ids.
  const renames: { id: string; from: string; to: string }[] = [];
  const conflicts: string[] = [];
  for (const [canonical, legacyNames] of Object.entries(LEGACY_SOURCE_NAMES)) {
    const rows = await prisma.jobListing.findMany({
      where: { source: { in: legacyNames } },
      select: { id: true, externalId: true, source: true },
    });
    if (!rows.length) continue;
    const clashes = await prisma.jobListing.findMany({
      where: { source: canonical, externalId: { in: rows.map((r) => r.externalId) } },
      select: { externalId: true },
    });
    const clash = new Set(clashes.map((c) => c.externalId));
    for (const r of rows) {
      if (clash.has(r.externalId)) conflicts.push(`${r.source}/${r.externalId}`);
      else renames.push({ id: r.id, from: r.source, to: canonical });
    }
  }
  console.log(`\nLegacy source renames: ${renames.length}${conflicts.length ? ` (${conflicts.length} skipped: canonical row already exists)` : ''}`);

  if (!apply) {
    console.log(`\nDry run: would delete ${deletable.length}, keep ${kept.length}, rename ${renames.length}.`);
    return;
  }

  const ids = deletable.map((j) => j.id);
  if (ids.length) {
    await prisma.$transaction([
      prisma.networkingContact.updateMany({ where: { targetJobId: { in: ids } }, data: { targetJobId: null } }),
      prisma.jobListing.deleteMany({ where: { id: { in: ids } } }),
    ]);
  }
  for (const r of renames) {
    await prisma.jobListing.update({ where: { id: r.id }, data: { source: r.to } });
  }
  console.log(`\nDeleted ${ids.length}, kept ${kept.length}, renamed ${renames.length}.`);
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
