"use client";

import React from "react";
import { BriefingCounts, BriefingItem, BriefingLink, BriefingResponse, BriefingSection, WeekStats } from "./types";

/** Dashboard deep link. Full navigation is fine: Dashboard reads `?tab=` on load. */
export function linkHref(link: BriefingLink): string {
  const params = new URLSearchParams({ tab: link.tab });
  if (link.id) params.set("id", link.id);
  for (const [k, v] of Object.entries(link.params || {})) params.set(k, v);
  return `/?${params.toString()}`;
}

/** "2026-10-15" -> "Thu, 15 Oct" without shifting the day by the viewer's timezone. */
export function formatDateKey(key: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return key;
  return new Date(`${key}T00:00:00.000Z`).toLocaleDateString("en-IN", { ...opts, timeZone: "UTC" });
}

export function formatIstTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
}

const SECTION_ICON: Record<string, string> = {
  actions: "🚨",
  networking: "🤝",
  matches: "🎯",
  movement: "📈",
  wellfound: "⚡",
  stale: "⏳",
};

const URGENCY_DOT: Record<BriefingItem["urgency"], string> = {
  high: "bg-rose-500",
  normal: "bg-indigo-400",
  low: "bg-slate-300",
};

export function ItemRow({ item }: { item: BriefingItem }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${URGENCY_DOT[item.urgency]}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${item.urgency === "high" ? "font-bold text-slate-900" : "font-semibold text-slate-800"}`}>{item.title}</p>
        {item.detail && <p className="mt-0.5 text-xs text-slate-600 break-words">{item.detail}</p>}
        {item.tags && item.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {item.tags.map((t) => (
              <span
                key={t}
                className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                  t.startsWith("Deadline") ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 bg-slate-50 text-slate-600"
                }`}
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
        {item.externalUrl && /^https?:\/\//i.test(item.externalUrl) && (
          <a
            href={item.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
          >
            Posting ↗
          </a>
        )}
        {item.link && (
          <a
            href={linkHref(item.link)}
            className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-indigo-500"
          >
            {item.link.label}
          </a>
        )}
      </div>
    </li>
  );
}

export function SectionCard({ section }: { section: BriefingSection }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs" aria-labelledby={`briefing-${section.key}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`briefing-${section.key}`} className="text-sm font-extrabold text-slate-900">
          <span aria-hidden>{SECTION_ICON[section.key]} </span>
          {section.title}
          {section.items.length > 0 && <span className="ml-1.5 text-xs font-bold text-slate-400">{section.items.length}</span>}
        </h3>
        {section.summary && <p className="text-[11px] text-slate-500">{section.summary}</p>}
      </div>
      {section.items.length ? (
        <ul className="mt-2 divide-y divide-slate-100">
          {section.items.map((item) => (
            <ItemRow key={item.key} item={item} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-slate-500">{section.emptyText}</p>
      )}
    </section>
  );
}

export type HeaderCounts = Pick<
  BriefingResponse,
  "needsAttentionCount" | "newApplicationsCount" | "interviewsCount" | "rejectionsCount" | "acceptedConnectionsCount"
> &
  Partial<Pick<BriefingCounts, "offersCount">>;

export function CountsHeader({ counts }: { counts: HeaderCounts }) {
  const tiles: Array<{ label: string; value: number | undefined; tone?: string }> = [
    { label: "Need attention", value: counts.needsAttentionCount, tone: counts.needsAttentionCount > 0 ? "border-amber-300 bg-amber-50" : undefined },
    { label: "Applied today", value: counts.newApplicationsCount },
    { label: "Interviews", value: counts.interviewsCount },
    { label: "Offers", value: counts.offersCount },
    { label: "Rejections", value: counts.rejectionsCount },
    { label: "Connections accepted", value: counts.acceptedConnectionsCount },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles
        .filter((t) => t.value !== undefined)
        .map((t) => (
          <div key={t.label} className={`rounded-xl border p-3 ${t.tone || "border-slate-200 bg-white"}`}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t.label}</p>
            <p className="mt-0.5 text-2xl font-extrabold text-slate-900">{t.value}</p>
          </div>
        ))}
    </div>
  );
}

const STAT_ROWS: Array<{ key: keyof WeekStats; label: string }> = [
  { key: "applications", label: "Applications" },
  { key: "responses", label: "Responses" },
  { key: "interviews", label: "Interviews" },
  { key: "contactsMessaged", label: "Contacts messaged" },
];

export function StatsCard({ thisWeek, lastWeek }: { thisWeek: WeekStats; lastWeek: WeekStats }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs" aria-labelledby="briefing-stats">
      <h3 id="briefing-stats" className="text-sm font-extrabold text-slate-900">
        <span aria-hidden>📊 </span>This week vs last week
      </h3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 font-semibold" />
              <th className="py-1 text-right font-semibold">This week</th>
              <th className="py-1 text-right font-semibold">Last week</th>
              <th className="py-1 text-right font-semibold">Change</th>
            </tr>
          </thead>
          <tbody>
            {STAT_ROWS.map(({ key, label }) => {
              const diff = thisWeek[key] - lastWeek[key];
              return (
                <tr key={key} className="border-t border-slate-100">
                  <td className="py-1.5 font-semibold text-slate-700">{label}</td>
                  <td className="py-1.5 text-right font-bold text-slate-900 tabular-nums">{thisWeek[key]}</td>
                  <td className="py-1.5 text-right text-slate-600 tabular-nums">{lastWeek[key]}</td>
                  <td className={`py-1.5 text-right font-semibold tabular-nums ${diff > 0 ? "text-emerald-700" : diff < 0 ? "text-rose-700" : "text-slate-400"}`}>
                    {diff > 0 ? `+${diff}` : diff < 0 ? `−${-diff}` : "±0"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Inline markdown: **bold**, _italic_, `code` and [links](url) (http(s) and app-relative only). */
function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|_(.+?)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${i++}`;
    if (m[1] !== undefined) out.push(<strong key={k}>{inline(m[1], k)}</strong>);
    else if (m[2] !== undefined) out.push(<code key={k} className="rounded bg-slate-100 px-1 text-[11px]">{m[2]}</code>);
    else if (m[3] !== undefined) {
      const href = m[4];
      const safe = /^https?:\/\//i.test(href) || href.startsWith("/");
      out.push(
        safe ? (
          <a key={k} href={href} className="text-indigo-700 underline" {...(href.startsWith("/") ? {} : { target: "_blank", rel: "noopener noreferrer" })}>
            {m[3]}
          </a>
        ) : (
          m[3]
        )
      );
    } else if (m[5] !== undefined) out.push(<em key={k}>{m[5]}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const unescape = (s: string) => s.replace(/\\([\\`*_[\]<>])/g, "$1");

/** Minimal, safe markdown for briefings stored before the structured format (no raw HTML). */
export function BriefingMarkdown({ content }: { content: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    const items = list;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="ml-5 list-disc space-y-1">
        {items.map((l, i) => (
          <li key={i}>{inline(unescape(l), `li-${blocks.length}-${i}`)}</li>
        ))}
      </ul>
    );
    list = [];
  };
  content.split("\n").forEach((raw, idx) => {
    const line = raw.trimEnd();
    if (/^\s*<!--/.test(line)) return;
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      list.push(bullet[1]);
      return;
    }
    flush();
    if (!line.trim() || /^-{3,}$/.test(line.trim()) || /^\|?\s*-{3}/.test(line)) return;
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const Tag = (`h${h[1].length + 1}` as "h2" | "h3" | "h4");
      blocks.push(
        <Tag key={idx} className={h[1].length === 1 ? "text-base font-extrabold" : "mt-3 text-sm font-bold"}>
          {inline(unescape(h[2]), `h-${idx}`)}
        </Tag>
      );
      return;
    }
    const text = line.replace(/^>\s?/, "").replace(/^\|(.*)\|$/, (_, row: string) => row.split("|").map((c) => c.trim()).join(" · "));
    blocks.push(
      <p key={idx} className="text-sm">
        {inline(unescape(text), `p-${idx}`)}
      </p>
    );
  });
  flush();
  return <div className="space-y-2 text-slate-800">{blocks}</div>;
}
