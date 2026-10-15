/**
 * The "In short" focus line: 2–3 sentences on what to do first. Deterministic by default;
 * with GEMINI_KEY set (and useAi) Gemini rewrites it from the structured data, validated and
 * falling back to the rule-based text.
 */
import { UNTRUSTED_NOTICE, generateText, hasPlaceholders, isGeminiConfigured, toPlainText, untrusted } from '../lib/gemini';
import { Briefing } from './types';

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export function ruleBasedInShort(b: Briefing): string {
  const section = (key: string) => b.sections.find((s) => s.key === key);
  const actions = section('actions')?.items ?? [];
  const people = section('networking')?.items ?? [];
  const matches = section('matches')?.items ?? [];
  const stale = section('stale')?.items ?? [];

  const sentences: string[] = [];
  const urgent = actions.filter((a) => a.urgency === 'high');
  if (urgent.length) {
    sentences.push(`Start with ${urgent[0].title.charAt(0).toLowerCase()}${urgent[0].title.slice(1)}${urgent.length > 1 ? ` (${plural(urgent.length - 1, 'more urgent item')} after that)` : ''}.`);
  } else if (actions.length) {
    sentences.push(`Clear ${plural(actions.length, 'pending action')} first, starting with: ${actions[0].title}.`);
  } else {
    sentences.push('No interviews, assessments or replies are waiting on you today.');
  }

  const next: string[] = [];
  if (people.length) next.push(`message ${people.map((p) => p.title.split(' — ')[0]).join(', ')}`);
  if (matches.length) next.push(`look at ${plural(matches.length, 'new match', 'new matches')} (best: ${matches[0].title})`);
  if (next.length) sentences.push(`Then ${next.join(' and ')}.`);

  if (stale.length) sentences.push(`${plural(stale.length, 'application')} ${stale.length === 1 ? 'has' : 'have'} gone 14+ days without a response — nudge someone there.`);
  else if (b.counts.newApplicationsCount === 0 && b.stats.thisWeek.applications < b.stats.lastWeek.applications) {
    sentences.push(`You've sent ${b.stats.thisWeek.applications} applications this week vs ${b.stats.lastWeek.applications} last week.`);
  }
  return sentences.slice(0, 3).join(' ');
}

/** Compact, id-free view of the briefing for the prompt. */
function promptData(b: Briefing): string {
  const lines: string[] = [];
  for (const s of b.sections) {
    lines.push(`${s.title}: ${s.items.length ? '' : 'none'}`);
    for (const i of s.items.slice(0, 5)) lines.push(`- [${i.urgency}] ${i.title}${i.detail ? ` (${i.detail})` : ''}`);
  }
  const { thisWeek: t, lastWeek: l } = b.stats;
  lines.push(`This week: ${t.applications} applications, ${t.responses} responses, ${t.interviews} interviews, ${t.contactsMessaged} contacts messaged.`);
  lines.push(`Last week: ${l.applications} applications, ${l.responses} responses, ${l.interviews} interviews, ${l.contactsMessaged} contacts messaged.`);
  return lines.join('\n');
}

export function validInShort(text: string | null): string | null {
  if (!text) return null;
  const plain = toPlainText(text).replace(/\s+/g, ' ').trim();
  if (plain.length < 30 || plain.length > 450) return null;
  if (hasPlaceholders(plain) || /https?:\/\/|<\/?untrusted/i.test(plain)) return null;
  const sentences = plain.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length > 4) return null;
  return plain;
}

export async function inShortFor(b: Briefing, opts: { useAi: boolean }): Promise<Briefing['inShort']> {
  const fallback = { text: ruleBasedInShort(b), source: 'rules' as const };
  if (!opts.useAi || !isGeminiConfigured()) return fallback;
  const prompt = [
    "You write the 'In short' line of a job seeker's daily briefing.",
    'In 2-3 plain sentences (no markdown, no links, no lists, under 400 characters), say what to focus on first today and why, using only the facts below.',
    'Prioritise interviews, assessments, offers and replies; then networking; then new matches. Do not invent names, companies or numbers.',
    UNTRUSTED_NOTICE,
    untrusted('briefing', promptData(b), 5000),
  ].join('\n\n');
  try {
    const text = validInShort(await generateText(prompt, { temperature: 0.3, timeoutMs: 15000, minLength: 30 }));
    return text ? { text, source: 'gemini' } : fallback;
  } catch {
    return fallback;
  }
}
