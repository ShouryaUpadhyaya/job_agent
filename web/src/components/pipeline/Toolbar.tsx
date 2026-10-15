"use client";

import React from "react";
import { PipelineFilters, PipelineStats, SORTS, SOURCES, SOURCE_LABELS, STAGES, STAGE_META, SortValue, Stage } from "./types";
import { FitHelp } from "./ui";

export type View = "list" | "kanban";

type Props = {
  filters: PipelineFilters;
  search: string;
  onSearch: (q: string) => void;
  onChange: (patch: Partial<PipelineFilters>) => void;
  stats: PipelineStats | null;
  view: View;
  onView: (v: View) => void;
};

export default function Toolbar({ filters, search, onSearch, onChange, stats, view, onView }: Props) {
  const toggleStage = (s: Stage) =>
    onChange({ stages: filters.stages.includes(s) ? filters.stages.filter((x) => x !== s) : [...filters.stages, s] });

  return (
    <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search title, company or notes"
          aria-label="Search applications"
          className="flex-1 min-w-[12rem] text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <select
          value={filters.source}
          onChange={(e) => onChange({ source: e.target.value })}
          aria-label="Source"
          className="text-sm px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl"
        >
          <option value="">All sources</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
              {stats?.sources[s] ? ` (${stats.sources[s]})` : ""}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-700 px-2 py-2 rounded-xl border border-slate-200 bg-slate-50 cursor-pointer">
          <input type="checkbox" checked={filters.hasAlumni} onChange={(e) => onChange({ hasAlumni: e.target.checked })} />
          Has VIT alumni
        </label>
        <span className="flex items-center gap-1.5">
          <select
            value={filters.sort}
            onChange={(e) => onChange({ sort: e.target.value as SortValue })}
            aria-label="Sort"
            className="text-sm px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                Sort: {s.label}
              </option>
            ))}
          </select>
          <FitHelp />
        </span>
        <div className="flex rounded-xl border border-slate-200 overflow-hidden text-sm" role="group" aria-label="View">
          {(["list", "kanban"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onView(v)}
              aria-pressed={view === v}
              className={`px-3 py-2 font-semibold ${view === v ? "bg-indigo-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              {v === "list" ? "List" : "Board"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5" aria-label="Filter by stage">
        <button
          type="button"
          onClick={() => onChange({ stages: [] })}
          aria-pressed={filters.stages.length === 0}
          className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${
            filters.stages.length === 0 ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
          }`}
        >
          All{stats ? ` ${stats.total}` : ""}
        </button>
        {STAGES.map((s) => {
          const active = filters.stages.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggleStage(s)}
              aria-pressed={active}
              className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${
                active ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {STAGE_META[s].label}
              {stats ? ` ${stats.stages[s] ?? 0}` : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}
