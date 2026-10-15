"use client";

import React, { useState } from "react";
import { FIT_EXPLANATION, PipelineApplication, SOURCE_LABELS, STAGE_META, isStage, stageLabel } from "./types";

export function StageBadge({ stage }: { stage: string }) {
  const tone = isStage(stage) ? STAGE_META[stage].badge : "bg-slate-50 text-slate-500 border-dashed border-slate-300";
  return <span className={`px-2 py-0.5 text-[11px] font-bold rounded-full border whitespace-nowrap ${tone}`}>{stageLabel(stage)}</span>;
}

export function SourceBadge({ source }: { source: string | null }) {
  const s = source || "manual";
  return (
    <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded border bg-slate-50 text-slate-600 border-slate-200 whitespace-nowrap">
      {SOURCE_LABELS[s] || s}
    </span>
  );
}

function scoreTone(score: number) {
  if (score >= 70) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (score >= 45) return "bg-amber-50 text-amber-800 border-amber-200";
  return "bg-slate-50 text-slate-600 border-slate-200";
}

export function MatchPill({ score }: { score: number }) {
  return (
    <span title="Resume match score from the matching engine" className={`px-1.5 py-0.5 text-[11px] font-bold rounded-md border whitespace-nowrap ${scoreTone(score)}`}>
      Match {score}
    </span>
  );
}

/** Fit score pill; hover shows a summary, click opens the full breakdown. */
export function FitPill({ fit }: { fit: PipelineApplication["fit"] }) {
  const [open, setOpen] = useState(false);
  const summary = fit.breakdown.map((c) => `${c.label}: ${c.points}/${c.max}`).join("\n");
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={summary}
        aria-expanded={open}
        className={`px-1.5 py-0.5 text-[11px] font-bold rounded-md border whitespace-nowrap ${fit.closed ? "bg-slate-50 text-slate-400 border-slate-200" : scoreTone(fit.score)}`}
      >
        Fit {fit.score}
      </button>
      {open && (
        <div role="dialog" aria-label="Fit breakdown" className="absolute z-20 left-0 mt-1 w-64 p-3 bg-white border border-slate-200 rounded-xl shadow-lg text-[11px] text-slate-700">
          <div className="flex justify-between items-center mb-2">
            <span className="font-bold text-slate-900">Fit {fit.score}/100</span>
            <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700" aria-label="Close fit breakdown">
              ×
            </button>
          </div>
          {fit.closed && <p className="mb-2 text-slate-500">Rejected or archived: fit is 0 so it sinks to the bottom.</p>}
          <ul className="space-y-1">
            {fit.breakdown.map((c) => (
              <li key={c.key} className="flex justify-between gap-2">
                <span>
                  <span className="font-semibold">{c.label}</span>
                  <span className="block text-slate-500">{c.detail}</span>
                </span>
                <span className="font-mono whitespace-nowrap">
                  {c.points}/{c.max}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}

export function FitHelp() {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={FIT_EXPLANATION}
        aria-label="How fit is calculated"
        className="w-5 h-5 text-[11px] font-bold rounded-full border border-slate-300 text-slate-500 hover:bg-slate-100"
      >
        ?
      </button>
      {open && (
        <span role="note" className="absolute z-20 right-0 mt-1 w-72 p-3 bg-white border border-slate-200 rounded-xl shadow-lg text-[11px] text-slate-600 block">
          {FIT_EXPLANATION}
        </span>
      )}
    </span>
  );
}

export interface Toast {
  id: number;
  message: string;
  tone: "error" | "info";
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-50 space-y-2 sm:w-96" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className={`flex items-start gap-3 p-3 rounded-xl border shadow-lg text-sm ${
            t.tone === "error" ? "bg-rose-50 border-rose-200 text-rose-800" : "bg-white border-slate-200 text-slate-700"
          }`}
        >
          <span className="flex-1">{t.message}</span>
          <button type="button" onClick={() => onDismiss(t.id)} className="text-slate-400 hover:text-slate-700" aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
