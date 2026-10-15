/**
 * Helpers for Gmail API message payloads (format: 'full'): header lookup, From parsing and
 * base64url body decoding. Only text/plain and text/html parts are read; attachments are not.
 */

export interface GmailPart {
  mimeType?: string | null;
  filename?: string | null;
  headers?: { name?: string | null; value?: string | null }[] | null;
  body?: { data?: string | null; size?: number | null; attachmentId?: string | null } | null;
  parts?: GmailPart[] | null;
}

const MAX_PART_CHARS = 200_000;
export const MAX_STORED_BODY = 20_000;

export function header(part: GmailPart | null | undefined, name: string): string {
  const h = part?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value || '';
}

export function decodeBase64Url(data: string | null | undefined): string {
  if (!data) return '';
  try {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

/** Collects decoded text/plain and text/html bodies, skipping attachments. */
export function extractBodies(payload: GmailPart | null | undefined): { text: string; html: string } {
  const texts: string[] = [];
  const htmls: string[] = [];
  const walk = (p: GmailPart | null | undefined, depth: number) => {
    if (!p || depth > 8) return;
    const type = (p.mimeType || '').toLowerCase();
    const isAttachment = Boolean(p.filename) || Boolean(p.body?.attachmentId);
    if (!isAttachment && p.body?.data) {
      const decoded = decodeBase64Url(p.body.data).slice(0, MAX_PART_CHARS);
      if (type === 'text/plain') texts.push(decoded);
      else if (type === 'text/html') htmls.push(decoded);
    }
    for (const child of p.parts || []) walk(child, depth + 1);
  };
  walk(payload, 0);
  return { text: texts.join('\n').slice(0, MAX_PART_CHARS), html: htmls.join('\n').slice(0, MAX_PART_CHARS) };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#?\w+);/g, (m, e: string) => {
      if (ENTITIES[e.toLowerCase()]) return ENTITIES[e.toLowerCase()];
      if (/^#\d+$/.test(e)) return String.fromCharCode(parseInt(e.slice(1), 10));
      return m;
    })
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** Readable body text for classification and storage (plain part preferred). */
export function bodyText(bodies: { text: string; html: string }): string {
  const t = bodies.text.trim() ? bodies.text : htmlToText(bodies.html);
  return t.replace(/\r\n/g, '\n').trim();
}

/** `"Jane Doe" <jane@acme.com>` → { name: 'Jane Doe', email: 'jane@acme.com' }. */
export function parseFrom(from: string): { name: string | null; email: string } {
  const raw = (from || '').trim();
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) {
    const name = m[1].replace(/\\"/g, '"').trim();
    return { name: name || null, email: m[2].trim().toLowerCase() };
  }
  const addr = raw.match(/[^\s<>"]+@[^\s<>"]+/);
  return { name: null, email: (addr ? addr[0] : raw).toLowerCase() };
}

export function senderDomain(email: string | null | undefined): string {
  const m = (email || '').toLowerCase().match(/@([a-z0-9.-]+)/);
  return m ? m[1] : '';
}

/** http(s) links in text or html, de-duplicated, entity-decoded. */
export function extractLinks(content: string): string[] {
  const out = new Set<string>();
  for (const m of (content || '').matchAll(/https?:\/\/[^\s"'<>)\]]+/gi)) {
    out.add(m[0].replace(/&amp;/g, '&').replace(/[.,;]+$/, ''));
  }
  return [...out];
}

const JOB_LINK_RE =
  /(boards\.greenhouse\.io|job-boards\.greenhouse\.io|jobs\.lever\.co|jobs\.ashbyhq\.com|myworkdayjobs\.com|smartrecruiters\.com\/[^/]+\/\d|apply\.workable\.com|linkedin\.com\/jobs\/view|naukri\.com\/job-listings|internshala\.com\/(internship|job)\/detail|wellfound\.com\/jobs\/\d|\/careers?\/.+\/\d{3,}|\/jobs?\/[^/?#]*\d{3,})/i;

/** Best guess at a link to the job posting itself (not tracking/unsubscribe links). */
export function jobPostingLink(content: string): string | null {
  return extractLinks(content).find((l) => JOB_LINK_RE.test(l) && !/unsubscribe|preferences/i.test(l)) || null;
}
