"use client";

import React from "react";
import { CLASSIFICATIONS, CLASSIFICATION_LABELS, CLASSIFICATION_TONES, EmailEvent, formatWhen } from "./types";

export interface EventFilters {
  classification: string;
  importance: string;
  linked: string;
  demo: "exclude" | "include" | "only";
}

export const DEFAULT_FILTERS: EventFilters = { classification: "ALL", importance: "ALL", linked: "ALL", demo: "exclude" };

const IMPORTANCE_TONE: Record<string, string> = {
  HIGH: "text-rose-700",
  NORMAL: "text-slate-500",
  LOW: "text-slate-400",
};

interface Props {
  events: EmailEvent[];
  loading: boolean;
  error: string | null;
  filters: EventFilters;
  onFilters: (f: EventFilters) => void;
}

export function EventsList({ events, loading, error, filters, onFilters }: Props) {
  const set = (patch: Partial<EventFilters>) => onFilters({ ...filters, ...patch });
  const select = "px-2 py-1.5 text-xs rounded-lg border border-slate-300 bg-white";

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden" aria-label="Email events">
      <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-extrabold text-slate-900">Email events ({events.length})</h3>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Type" value={filters.classification} onChange={(e) => set({ classification: e.target.value })} className={select}>
            <option value="ALL">All types</option>
            {CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>
                {CLASSIFICATION_LABELS[c]}
              </option>
            ))}
          </select>
          <select aria-label="Importance" value={filters.importance} onChange={(e) => set({ importance: e.target.value })} className={select}>
            <option value="ALL">Any importance</option>
            <option value="HIGH">High</option>
            <option value="NORMAL">Normal</option>
            <option value="LOW">Low</option>
          </select>
          <select aria-label="Linked" value={filters.linked} onChange={(e) => set({ linked: e.target.value })} className={select}>
            <option value="ALL">Linked or not</option>
            <option value="linked">Linked to application/contact</option>
            <option value="unlinked">Not linked</option>
          </select>
          <select aria-label="Demo events" value={filters.demo} onChange={(e) => set({ demo: e.target.value as EventFilters["demo"] })} className={select}>
            <option value="exclude">Real emails only</option>
            <option value="include">Real + demo</option>
            <option value="only">Demo only</option>
          </select>
        </div>
      </div>

      {error ? (
        <div className="p-6 text-center text-rose-700 text-xs" role="alert">
          Could not load events: {error}
        </div>
      ) : loading && events.length === 0 ? (
        <div className="p-8 text-center text-slate-400 text-xs">Loading email events…</div>
      ) : events.length === 0 ? (
        <div className="p-8 text-center text-slate-400 text-xs">No email events match these filters.</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {events.map((ev) => (
            <li key={ev.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${CLASSIFICATION_TONES[ev.classification] || CLASSIFICATION_TONES.UNKNOWN}`}>
                      {CLASSIFICATION_LABELS[ev.classification] || ev.classification}
                    </span>
                    {ev.isDemo && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-dashed border-amber-300 text-amber-700">DEMO</span>}
                    {ev.importance && ev.importance !== "NORMAL" && (
                      <span className={`text-[10px] font-bold ${IMPORTANCE_TONE[ev.importance]}`}>{ev.importance === "HIGH" ? "High priority" : "Low priority"}</span>
                    )}
                    {ev.company && <span className="text-xs font-bold text-slate-800">{ev.company}</span>}
                    {ev.role && <span className="text-xs text-slate-500">{ev.role}</span>}
                    <span className="text-[11px] text-slate-400">{formatWhen(ev.receivedAt)}</span>
                  </div>
                  <h4 className="text-xs font-bold text-slate-900 mt-1">{ev.subject}</h4>
                  <p className="text-[11px] text-slate-500">
                    From {ev.senderName ? `${ev.senderName} <${ev.sender}>` : ev.sender}
                  </p>
                  {ev.snippet && <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{ev.snippet}</p>}
                  {ev.suggestedAction && (
                    <p className="mt-2 text-[11px] bg-slate-50 text-slate-700 px-2.5 py-1 rounded-md">
                      <span className="font-semibold text-slate-900">Next: </span>
                      {ev.suggestedAction}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-3 text-[11px] font-semibold">
                    {ev.jobApplication && (
                      <a href="?tab=PIPELINE" className="text-indigo-700 hover:underline">
                        Application: {ev.jobApplication.jobListing.company} · {ev.jobApplication.jobListing.title} ({ev.jobApplication.stage})
                      </a>
                    )}
                    {ev.networkingContact && (
                      <a href="?tab=NETWORKING" className="text-emerald-700 hover:underline">
                        Contact: {ev.networkingContact.name} ({ev.networkingContact.company})
                      </a>
                    )}
                    {!ev.jobApplication && !ev.networkingContact && !ev.isDemo && <span className="text-slate-400 font-normal">Not linked</span>}
                  </div>
                  {ev.explanation && <p className="mt-1 text-[11px] text-slate-400">{ev.explanation}</p>}
                </div>
                <span className="text-[10px] text-slate-400 font-mono shrink-0">{Math.round(ev.confidence * 100)}%</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
