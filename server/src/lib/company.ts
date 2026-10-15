/**
 * Company-name normalisation used to join jobs, applications, contacts and emails
 * that refer to the same company under slightly different names
 * (e.g. "Razorpay Software Pvt. Ltd." vs "razorpay").
 */

const LEGAL_SUFFIXES = [
  'private limited',
  'pvt ltd',
  'pvt',
  'limited',
  'ltd',
  'llp',
  'llc',
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'co',
  'company',
  'gmbh',
  'plc',
  'sa',
  'bv',
];

const GENERIC_WORDS = ['technologies', 'technology', 'tech', 'labs', 'software', 'solutions', 'services', 'india', 'hq', 'global'];

export function companyKey(name: string | null | undefined): string {
  if (!name) return '';
  let s = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, ' ') // "(YC W24)"
    .replace(/&/g, ' and ')
    .replace(/\.(com|io|ai|in|co|app|dev|so|xyz)\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip trailing legal suffixes and generic words repeatedly ("Foo Technologies Pvt Ltd" -> "foo").
  const tails = [...LEGAL_SUFFIXES, ...GENERIC_WORDS].sort((a, b) => b.length - a.length);
  let changed = true;
  while (changed) {
    changed = false;
    for (const tail of tails) {
      if (s.endsWith(' ' + tail)) {
        s = s.slice(0, -tail.length - 1).trim();
        changed = true;
      }
    }
  }
  return s.replace(/ /g, '');
}

export function sameCompany(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = companyKey(a);
  return ka !== '' && ka === companyKey(b);
}
