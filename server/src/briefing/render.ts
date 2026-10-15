/**
 * Markdown rendering of a structured briefing, and the storage format: the markdown followed by
 * the structured JSON in a trailing HTML comment (invisible when the markdown is rendered), so
 * DailyJobSearchSummary keeps a single `content` column.
 */
import { Briefing, BriefingItem, BriefingLink, WeekStats } from './types';

const DATA_PREFIX = '<!-- briefing-data ';
const DATA_SUFFIX = ' -->';

export function linkHref(link: BriefingLink): string {
  const params = new URLSearchParams({ tab: link.tab });
  if (link.id) params.set('id', link.id);
  for (const [k, v] of Object.entries(link.params || {})) params.set(k, v);
  return `/?${params.toString()}`;
}

/** Escapes characters that would change markdown structure inside link text / inline text. */
function md(text: string): string {
  return text.replace(/([\\`*_[\]<>])/g, '\\$1');
}

function itemLine(item: BriefingItem): string {
  const url = item.externalUrl && /^https?:\/\//i.test(item.externalUrl) ? item.externalUrl : null;
  const title = url ? `[${md(item.title)}](${url.replace(/[()\s<>]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'))})` : md(item.title);
  const bits = [item.urgency === 'high' ? `**${title}**` : title];
  if (item.detail) bits.push(md(item.detail));
  if (item.tags?.length) bits.push(item.tags.map((t) => `\`${t.replace(/`/g, "'")}\``).join(' '));
  if (item.link) bits.push(`[${md(item.link.label)}](${linkHref(item.link)})`);
  return `- ${bits.join(' — ')}`;
}

function delta(a: number, b: number): string {
  if (a === b) return '±0';
  return a > b ? `+${a - b}` : `−${b - a}`;
}

export function formatIstDate(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00.000Z`).toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatIstTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}

const TRIGGER_TEXT: Record<Briefing['trigger'], string> = {
  scheduled: 'scheduled',
  manual: 'regenerated manually',
  'on-demand': 'generated on first view',
  live: 'live preview',
};

export function renderMarkdown(b: Briefing): string {
  const out: string[] = [];
  out.push(`# Daily briefing — ${formatIstDate(b.date)}`);
  out.push(`_Generated ${formatIstTime(b.generatedAt)} IST (${TRIGGER_TEXT[b.trigger]})._`);
  out.push('');
  const c = b.counts;
  out.push(
    `**${c.needsAttentionCount}** need attention · **${c.newApplicationsCount}** applied today · **${c.interviewsCount}** interviews · ` +
      `**${c.offersCount}** offers · **${c.rejectionsCount}** rejections · **${c.acceptedConnectionsCount}** connections accepted`
  );
  out.push('');
  if (b.inShort.text) {
    out.push(`> **In short:** ${md(b.inShort.text)}`);
    out.push('');
  }
  for (const s of b.sections) {
    out.push(`## ${s.title}${s.items.length ? ` (${s.items.length})` : ''}`);
    if (s.summary) out.push(`_${md(s.summary)}_`);
    if (s.items.length) out.push(...s.items.map(itemLine));
    else out.push(`_${md(s.emptyText)}_`);
    out.push('');
  }
  const { thisWeek: t, lastWeek: l } = b.stats;
  const row = (label: string, key: keyof WeekStats) => `| ${label} | ${t[key]} | ${l[key]} | ${delta(t[key], l[key])} |`;
  out.push('## This week vs last week');
  out.push('| | This week | Last week | Change |');
  out.push('|---|---:|---:|---:|');
  out.push(row('Applications', 'applications'), row('Responses', 'responses'), row('Interviews', 'interviews'), row('Contacts messaged', 'contactsMessaged'));
  out.push('');
  out.push('---');
  out.push(`_Job Agent daily briefing${b.candidateName ? ` for ${md(b.candidateName)}` : ''}._`);
  return out.join('\n');
}

/** Markdown plus the structured data, as stored in DailyJobSearchSummary.content. */
export function toStoredContent(b: Briefing, markdown = renderMarkdown(b)): string {
  // "--" can't appear inside an HTML comment; JSON-escape it inside strings (it never occurs outside).
  const json = JSON.stringify(b).replace(/--/g, '-\\u002d');
  return `${markdown}\n\n${DATA_PREFIX}${json}${DATA_SUFFIX}\n`;
}

/** Splits stored content into markdown and the structured briefing (null for older rows). */
export function parseStoredContent(content: string): { markdown: string; briefing: Briefing | null } {
  const at = content.lastIndexOf(DATA_PREFIX);
  if (at === -1) return { markdown: content, briefing: null };
  const end = content.indexOf(DATA_SUFFIX, at + DATA_PREFIX.length);
  const markdown = content.slice(0, at).trimEnd();
  if (end === -1) return { markdown, briefing: null };
  try {
    const data = JSON.parse(content.slice(at + DATA_PREFIX.length, end));
    return { markdown, briefing: data && data.version === 1 && Array.isArray(data.sections) ? (data as Briefing) : null };
  } catch {
    return { markdown, briefing: null };
  }
}
