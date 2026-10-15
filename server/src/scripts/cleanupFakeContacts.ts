/**
 * Removes networking contacts fabricated by earlier versions (crm.ts persona templates, the
 * "Generate 4 Leads" button, Wellfound placeholders):
 *   - names like "Senior Software Engineer (Linear)", "University Recruiter (X)", …
 *   - or a profileUrl that is a LinkedIn *search* URL instead of a profile
 * Their messages are deleted (cascade) and any EmailEvent links are cleared.
 * Also backfills companyKey, and copies a real /in/ profileUrl into linkedinUrl.
 *
 * Dry run (default):  npx tsx src/scripts/cleanupFakeContacts.ts
 * Apply:              npx tsx src/scripts/cleanupFakeContacts.ts --apply
 * Take a pg_dump backup first.
 */
import { prisma } from '../db';
import { companyKey } from '../lib/company';
import { normalizeLinkedinUrl } from '../networking/parse';

export const PLACEHOLDER_NAME_PREFIXES = [
  'Senior Software Engineer',
  'University Recruiter',
  'Backend Engineer',
  'Engineering Manager',
  'Engineering Team',
  'Talent Partner',
  'Software Engineer',
  'Technical Recruiter',
  'Hiring Manager',
  'Founder',
  'Recruiter',
];

/** "Senior Software Engineer (Linear)" — a role title followed by the company in parentheses. */
export function isPlaceholderName(name: string): boolean {
  const m = name.trim().match(/^(.+?)\s*\((.+)\)$/);
  if (!m) return false;
  const head = m[1].trim().toLowerCase();
  return PLACEHOLDER_NAME_PREFIXES.some((p) => head === p.toLowerCase());
}

export function isSearchProfileUrl(url: string | null | undefined): boolean {
  return Boolean(url && /linkedin\.com\/(search|jobs\/search)\b/i.test(url));
}

export function isFabricatedContact(c: { name: string; company: string; profileUrl: string | null }): boolean {
  return isPlaceholderName(c.name) || isSearchProfileUrl(c.profileUrl);
}

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? 'Mode: APPLY (changes will be written)' : 'Mode: DRY RUN (pass --apply to write changes)');

  const contacts = await prisma.networkingContact.findMany({
    include: { _count: { select: { messages: true, emailEvents: true } } },
    orderBy: [{ company: 'asc' }, { name: 'asc' }],
  });
  const fake = contacts.filter(isFabricatedContact);
  const real = contacts.filter((c) => !isFabricatedContact(c));

  console.log(`\nContacts: ${contacts.length} total, ${fake.length} fabricated, ${real.length} kept.`);
  for (const c of fake) {
    const why = isPlaceholderName(c.name) ? 'placeholder name' : 'search URL as profile';
    console.log(
      `  delete  ${c.name} @ ${c.company}  [${why}]  messages=${c._count.messages} emailLinks=${c._count.emailEvents}`
    );
  }
  const messageCount = fake.reduce((s, c) => s + c._count.messages, 0);
  const emailLinks = fake.reduce((s, c) => s + c._count.emailEvents, 0);

  const backfills: { id: string; data: Record<string, string> }[] = [];
  for (const c of real) {
    const data: Record<string, string> = {};
    const key = companyKey(c.company);
    if (c.companyKey !== key) data.companyKey = key;
    if (!c.linkedinUrl && c.profileUrl) {
      const li = normalizeLinkedinUrl(c.profileUrl);
      if (li.ok && li.value) data.linkedinUrl = li.value;
    }
    if (Object.keys(data).length) backfills.push({ id: c.id, data });
  }
  console.log(`\nBackfills for kept contacts (companyKey / linkedinUrl): ${backfills.length}`);

  if (!apply) {
    console.log(
      `\nDry run: would delete ${fake.length} contact(s) and ${messageCount} message(s), unlink ${emailLinks} email event(s), backfill ${backfills.length}.`
    );
    return;
  }

  const ids = fake.map((c) => c.id);
  if (ids.length) {
    await prisma.$transaction([
      prisma.emailEvent.updateMany({ where: { networkingContactId: { in: ids } }, data: { networkingContactId: null } }),
      prisma.networkingMessage.deleteMany({ where: { contactId: { in: ids } } }),
      prisma.networkingContact.deleteMany({ where: { id: { in: ids } } }),
    ]);
  }
  for (const b of backfills) {
    await prisma.networkingContact.update({ where: { id: b.id }, data: b.data });
  }
  console.log(
    `\nDeleted ${ids.length} contact(s) and ${messageCount} message(s), unlinked ${emailLinks} email event(s), backfilled ${backfills.length}.`
  );
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
