"use client";

import React from "react";
import { DEFAULT_FILTERS, Facets, Filters } from "./types";

type Props = {
  filters: Filters;
  facets: Facets | null;
  onChange: (next: Filters) => void;
};

const POSTED_OPTIONS: { label: string; value: number | "" }[] = [
  { label: "Any time", value: "" },
  { label: "Last 24 hours", value: 1 },
  { label: "Last 3 days", value: 3 },
  { label: "Last 7 days", value: 7 },
  { label: "Last 14 days", value: 14 },
  { label: "Last 30 days", value: 30 },
];

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 rounded" />
      <span>
        {label}
        {hint && <span className="block text-[10px] font-normal text-slate-400">{hint}</span>}
      </span>
    </label>
  );
}

export default function FilterSidebar({ filters, facets, onChange }: Props) {
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });
  const toggleSource = (value: string) =>
    set("sources", filters.sources.includes(value) ? filters.sources.filter((s) => s !== value) : [...filters.sources, value]);

  return (
    <aside className="w-60 shrink-0 border-r border-gray-200 bg-white overflow-y-auto p-4 space-y-5" aria-label="Job filters">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Filters</h2>
        <button onClick={() => onChange({ ...DEFAULT_FILTERS, sort: filters.sort })} className="text-[11px] font-semibold text-indigo-600 hover:underline">
          Reset
        </button>
      </div>

      <div className="space-y-2">
        <Toggle label="Internships only" checked={filters.internshipOnly} onChange={(v) => set("internshipOnly", v)} hint={facets ? `${facets.internships} open` : undefined} />
        <Toggle label="Saved only" checked={filters.savedOnly} onChange={(v) => set("savedOnly", v)} hint={facets ? `${facets.saved} saved` : undefined} />
        <Toggle label="Hide applied" checked={filters.hideApplied} onChange={(v) => set("hideApplied", v)} />
        <Toggle label="Show dismissed" checked={filters.showDismissed} onChange={(v) => set("showDismissed", v)} hint={facets ? `${facets.dismissed} dismissed` : undefined} />
      </div>

      <div>
        <label htmlFor="posted-within" className="block text-[11px] font-bold text-slate-600 mb-1">Posted within</label>
        <select
          id="posted-within"
          value={filters.postedWithinDays}
          onChange={(e) => set("postedWithinDays", e.target.value ? Number(e.target.value) : "")}
          className="w-full text-xs p-1.5 border border-slate-200 rounded-md bg-slate-50"
        >
          {POSTED_OPTIONS.map((o) => (
            <option key={o.label} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="location-filter" className="block text-[11px] font-bold text-slate-600 mb-1">Location</label>
        <input
          id="location-filter"
          type="text"
          value={filters.location}
          placeholder="e.g. Bengaluru"
          onChange={(e) => set("location", e.target.value)}
          className="w-full text-xs p-1.5 border border-slate-200 rounded-md bg-slate-50"
        />
        <div className="mt-2">
          <Toggle label="Remote only" checked={filters.remote} onChange={(v) => set("remote", v)} />
        </div>
      </div>

      <div>
        <label htmlFor="min-score" className="block text-[11px] font-bold text-slate-600 mb-1">
          Minimum match: <span className="text-indigo-700">{filters.minScore}</span>
        </label>
        <input
          id="min-score"
          type="range"
          min={0}
          max={90}
          step={5}
          value={filters.minScore}
          onChange={(e) => set("minScore", Number(e.target.value))}
          className="w-full"
        />
      </div>

      <div>
        <label htmlFor="status-filter" className="block text-[11px] font-bold text-slate-600 mb-1">Match class</label>
        <select id="status-filter" value={filters.status} onChange={(e) => set("status", e.target.value)} className="w-full text-xs p-1.5 border border-slate-200 rounded-md bg-slate-50">
          <option value="ALL">All</option>
          <option value="APPLY">Apply</option>
          <option value="REVIEW">Review</option>
          <option value="SKIP">Skip</option>
        </select>
      </div>

      {facets && facets.resumes.length > 1 && (
        <div>
          <label htmlFor="resume-filter" className="block text-[11px] font-bold text-slate-600 mb-1">Best resume</label>
          <select id="resume-filter" value={filters.resumeId} onChange={(e) => set("resumeId", e.target.value)} className="w-full text-xs p-1.5 border border-slate-200 rounded-md bg-slate-50">
            <option value="">Any</option>
            {facets.resumes.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </div>
      )}

      <fieldset>
        <legend className="text-[11px] font-bold text-slate-600 mb-1">Sources</legend>
        {!facets && <p className="text-[11px] text-slate-400">Loading…</p>}
        {facets && facets.sources.length === 0 && <p className="text-[11px] text-slate-400">No jobs yet.</p>}
        <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
          {facets?.sources.map((s) => (
            <label key={s.value} className="flex items-center justify-between gap-2 text-xs text-slate-700 cursor-pointer">
              <span className="flex items-center gap-1.5 min-w-0">
                <input type="checkbox" aria-label={`Source: ${s.label}`} checked={filters.sources.includes(s.value)} onChange={() => toggleSource(s.value)} className="rounded" />
                <span className="truncate">{s.label}</span>
              </span>
              <span className="text-[10px] text-slate-400 tabular-nums">{s.count}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </aside>
  );
}
