"use client";

import React, { useState } from "react";
import { PERSONA_LABELS, PriorityItem, SOURCE_LABELS, STATUS_LABELS } from "./types";

export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await copyText(text);
        setState(ok ? "ok" : "fail");
        setTimeout(() => setState("idle"), 2000);
      }}
      className={`px-2 py-0.5 text-[11px] font-semibold rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 ${className}`}
    >
      {state === "ok" ? "Copied" : state === "fail" ? "Copy failed: select the text" : label}
    </button>
  );
}

const STATUS_TONE: Record<string, string> = {
  RESEARCHED: "bg-slate-50 text-slate-700 border-slate-200",
  READY_TO_CONNECT: "bg-sky-50 text-sky-700 border-sky-200",
  REQUEST_SENT: "bg-blue-50 text-blue-700 border-blue-200",
  ACCEPTED: "bg-indigo-50 text-indigo-700 border-indigo-200",
  MESSAGE_DRAFTED: "bg-violet-50 text-violet-700 border-violet-200",
  MESSAGE_SENT: "bg-violet-50 text-violet-700 border-violet-200",
  REPLIED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REFERRAL_REQUESTED: "bg-amber-50 text-amber-800 border-amber-200",
  REFERRED: "bg-emerald-100 text-emerald-800 border-emerald-300",
  NOT_INTERESTED: "bg-slate-100 text-slate-500 border-slate-200",
  FOLLOW_UP_DUE: "bg-rose-50 text-rose-700 border-rose-200",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full border ${STATUS_TONE[status] || STATUS_TONE.RESEARCHED}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export function Badge({ children, tone = "slate", title }: { children: React.ReactNode; tone?: "slate" | "emerald" | "indigo" | "amber"; title?: string }) {
  const tones = {
    slate: "bg-slate-50 text-slate-600 border-slate-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    indigo: "bg-indigo-50 text-indigo-700 border-indigo-200",
    amber: "bg-amber-50 text-amber-800 border-amber-200",
  };
  return (
    <span title={title} className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function PersonaBadge({ persona }: { persona: string }) {
  return <Badge tone="indigo">{PERSONA_LABELS[persona] || persona}</Badge>;
}

export function SourceBadge({ source }: { source: string }) {
  return <Badge>{SOURCE_LABELS[source] || source}</Badge>;
}

export function AlumniBadge() {
  return (
    <Badge tone="emerald" title="School mentions VIT">
      VIT alumni
    </Badge>
  );
}

/** Score with its breakdown shown on hover/focus (and as a title for screen readers). */
export function PriorityPill({ score, breakdown }: { score: number; breakdown?: PriorityItem[] }) {
  const [open, setOpen] = useState(false);
  const text = (breakdown || []).map((b) => `${b.points > 0 ? "+" : ""}${b.points} ${b.label}`).join("\n");
  const tone = score >= 70 ? "bg-emerald-600 text-white" : score >= 45 ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-700";
  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-label={`Priority ${score}`}
        title={text}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${tone}`}
      >
        {score}
      </button>
      {open && breakdown && breakdown.length > 0 && (
        <span role="tooltip" className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-lg text-[11px] text-slate-700">
          <span className="block font-semibold text-slate-900 mb-1">Priority {score}/100</span>
          {breakdown.map((b) => (
            <span key={b.label} className="flex justify-between gap-2">
              <span>{b.label}</span>
              <span className={b.points < 0 ? "text-rose-600" : "text-emerald-700"}>
                {b.points > 0 ? "+" : ""}
                {b.points}
              </span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

/** LinkedIn / X / GitHub links (open in a new tab) and the email as copyable text. */
export function ContactLinks({
  linkedinUrl,
  xUrl,
  githubUrl,
  email,
  emailSource,
}: {
  linkedinUrl?: string | null;
  xUrl?: string | null;
  githubUrl?: string | null;
  email?: string | null;
  emailSource?: string | null;
}) {
  const link = "px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {linkedinUrl && (
        <a href={linkedinUrl} target="_blank" rel="noopener noreferrer" className={link}>
          LinkedIn
        </a>
      )}
      {xUrl && (
        <a href={xUrl} target="_blank" rel="noopener noreferrer" className={link}>
          X
        </a>
      )}
      {githubUrl && (
        <a href={githubUrl} target="_blank" rel="noopener noreferrer" className={link}>
          GitHub
        </a>
      )}
      {email && (
        <span className="inline-flex items-center gap-1 text-[11px] text-slate-700">
          <span className="font-mono select-all" title={emailSource ? `Email from ${emailSource}` : undefined}>
            {email}
          </span>
          <CopyButton text={email} />
        </span>
      )}
      {!linkedinUrl && !xUrl && !githubUrl && !email && <span className="text-[11px] text-slate-400">No profile links yet</span>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`bg-white rounded-2xl w-full ${wide ? "max-w-3xl" : "max-w-lg"} max-h-[90vh] overflow-y-auto p-6 shadow-xl border border-slate-200`}>
        <div className="flex items-center justify-between gap-4 mb-4">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <button type="button" onClick={onClose} className="text-xs font-semibold text-slate-500 hover:text-slate-800">
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}
