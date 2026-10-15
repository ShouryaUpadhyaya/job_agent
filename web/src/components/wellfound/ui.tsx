"use client";

import React from "react";
import { PreflightCheck, RunStatus } from "./types";

export type Notice = { type: "success" | "error" | "info"; text: string } | null;

export function NoticeBanner({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  if (!notice) return null;
  const tone =
    notice.type === "success"
      ? "bg-emerald-50 border-emerald-200 text-emerald-800"
      : notice.type === "error"
        ? "bg-rose-50 border-rose-200 text-rose-800"
        : "bg-blue-50 border-blue-200 text-blue-800";
  return (
    <div role="status" className={`p-3 rounded-xl text-sm border flex items-start justify-between gap-4 ${tone}`}>
      <span className="whitespace-pre-line">{notice.text}</span>
      <button onClick={onClose} className="text-xs font-bold underline opacity-75 hover:opacity-100 shrink-0">
        Dismiss
      </button>
    </div>
  );
}

const STATUS_TONE: Record<RunStatus, string> = {
  STARTING: "bg-blue-50 text-blue-700 border-blue-200",
  RUNNING: "bg-blue-50 text-blue-700 border-blue-200",
  SUCCEEDED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  FAILED: "bg-rose-50 text-rose-700 border-rose-200",
  STOPPED: "bg-slate-100 text-slate-600 border-slate-200",
};

export function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full border ${STATUS_TONE[status] || STATUS_TONE.STOPPED}`}>
      {status}
    </span>
  );
}

export function ModeBadge({ mode }: { mode: "DRY_RUN" | "LIVE" }) {
  return mode === "LIVE" ? (
    <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full border bg-amber-50 text-amber-800 border-amber-200">LIVE</span>
  ) : (
    <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full border bg-slate-50 text-slate-600 border-slate-200">DRY RUN</span>
  );
}

export function Card({ title, children, actions }: { title?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {title && <h3 className="text-sm font-bold text-slate-900">{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function PreflightList({ checks }: { checks: PreflightCheck[] }) {
  return (
    <ul className="space-y-2" aria-label="Preflight checklist">
      {checks.map((c) => (
        <li key={c.id} className="flex items-start gap-3 text-sm">
          <span
            aria-label={c.ok ? "ok" : c.required ? "failed" : "warning"}
            className={`mt-0.5 w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold ${
              c.ok ? "bg-emerald-100 text-emerald-700" : c.required ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"
            }`}
          >
            {c.ok ? "✓" : c.required ? "✕" : "!"}
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-slate-800">
              {c.label}
              {!c.required && <span className="ml-2 text-[11px] font-normal text-slate-400">optional</span>}
            </div>
            {c.detail && <div className="text-xs text-slate-500 break-words">{c.detail}</div>}
            {!c.ok && c.fix && <div className="mt-1 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">Fix: {c.fix}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

const LEVEL_TONE: [RegExp, string][] = [
  [/ (ERROR|STDERR) /, "text-rose-300"],
  [/ WARN /, "text-amber-300"],
  [/ DIAG /, "text-violet-300"],
  [/ SUMMARY /, "text-emerald-300 font-semibold"],
  [/ PAGEERR /, "text-slate-500"],
  [/ PAGE /, "text-sky-200"],
  [/ (SERVER|AGENT) /, "text-slate-400"],
];

export function LogLines({ lines, emptyText }: { lines: string[]; emptyText: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <div
      ref={ref}
      data-testid="log-console"
      className="bg-slate-950 rounded-xl p-4 font-mono text-[11.5px] leading-relaxed h-96 overflow-y-auto border border-slate-800"
    >
      {lines.length === 0 ? (
        <div className="text-slate-500">{emptyText}</div>
      ) : (
        lines.map((line, i) => (
          <div key={i} className={`whitespace-pre-wrap break-words ${LEVEL_TONE.find(([re]) => re.test(line))?.[1] || "text-slate-200"}`}>
            {line}
          </div>
        ))
      )}
    </div>
  );
}

export function formatIst(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function duration(from: string, to: string | null): string {
  const ms = (to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime();
  if (!isFinite(ms) || ms < 0) return "—";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m ? `${m}m ${s}s` : `${s}s`;
}
