"use client";

import React from "react";
import { CLASSIFICATION_LABELS, GmailSummary, KIND_LABELS, formatWhen } from "./types";

const KIND_TONE: Record<string, string> = {
  OFFER: "bg-emerald-50 text-emerald-800 border-emerald-200",
  INTERVIEW: "bg-purple-50 text-purple-800 border-purple-200",
  ASSESSMENT: "bg-amber-50 text-amber-800 border-amber-200",
  RECRUITER_REPLY: "bg-indigo-50 text-indigo-800 border-indigo-200",
  FOLLOW_UP: "bg-orange-50 text-orange-800 border-orange-200",
};

function linkLabel(link: string): string {
  if (link.includes("PIPELINE")) return "Open in Pipeline";
  if (link.includes("NETWORKING")) return "Open in Networking";
  return "View email";
}

export function SummaryPanel({ summary, loading, error }: { summary: GmailSummary | null; loading: boolean; error: string | null }) {
  if (loading && !summary) return <section className="bg-white rounded-xl border border-slate-200 p-5 text-xs text-slate-400">Loading summary…</section>;
  if (error) return <section className="bg-white rounded-xl border border-rose-200 p-5 text-xs text-rose-700" role="alert">Could not load the summary: {error}</section>;
  if (!summary) return null;

  const counts = Object.entries(summary.counts).sort((a, b) => b[1] - a[1]);

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4" aria-label="Inbox summary">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-extrabold text-slate-900">Last {summary.days} days</h3>
        <span className="text-[11px] text-slate-400">{summary.totalEvents} job emails</span>
      </div>

      {summary.aiSummary ? (
        <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700 bg-slate-50 rounded-lg p-3" aria-label="AI summary">
          {summary.aiSummary}
        </pre>
      ) : (
        <ul className="text-xs text-slate-700 list-disc ml-5 space-y-0.5">
          {summary.highlights.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}

      <div>
        <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 mb-2">Needs action ({summary.needsAction.length})</h4>
        {summary.needsAction.length === 0 ? (
          <p className="text-xs text-slate-400">Nothing waiting on you.</p>
        ) : (
          <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
            {summary.needsAction.map((n) => (
              <li key={n.eventId} className="p-3 flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${KIND_TONE[n.kind]}`}>{KIND_LABELS[n.kind]}</span>
                    <span className="text-xs font-bold text-slate-900">{n.company || n.senderName || n.sender}</span>
                    {n.role && <span className="text-xs text-slate-500">{n.role}</span>}
                    {n.deadline && <span className="text-[11px] font-bold text-rose-700">Deadline: {n.deadline}</span>}
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5 truncate">{n.subject}</p>
                  <p className="text-[11px] text-slate-400">{formatWhen(n.receivedAt)}</p>
                </div>
                <a href={n.link} className="text-[11px] font-bold text-indigo-700 hover:underline shrink-0">
                  {linkLabel(n.link)}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {summary.statusChanges.length > 0 && (
        <div>
          <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 mb-2">Stage changes from email</h4>
          <ul className="text-xs text-slate-700 space-y-1">
            {summary.statusChanges.map((c) => (
              <li key={c.eventId}>
                <a href="?tab=PIPELINE" className="font-semibold hover:underline">
                  {c.company} · {c.title}
                </a>
                : {c.from} → {c.to}
                <span className="text-slate-400"> ({formatWhen(c.at)})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-xs text-slate-600">
        {summary.newApplications.length > 0 && (
          <a href="?tab=PIPELINE" className="hover:underline">
            {summary.newApplications.length} new application{summary.newApplications.length > 1 ? "s" : ""} detected
          </a>
        )}
        {summary.jobAlerts.emails > 0 && (
          <a href="?tab=DISCOVERY" className="hover:underline">
            {summary.jobAlerts.emails} job alert{summary.jobAlerts.emails > 1 ? "s" : ""}, {summary.jobAlerts.listingsAdded} new listings
          </a>
        )}
      </div>

      {counts.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Counts by type">
          {counts.map(([k, v]) => (
            <span key={k} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              {CLASSIFICATION_LABELS[k] || k}: {v}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
