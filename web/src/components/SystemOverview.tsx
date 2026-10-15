"use client";

import React, { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";

export type Overview = {
  generatedAt: string;
  jobs: {
    active: number;
    bySource: Record<string, number>;
    freshness: { within3d: number; within7d: number; within30d: number; older: number };
    internships: number;
    saved: number;
    apply: number;
    review: number;
  };
  applications: {
    total: number;
    byStage: Record<string, number>;
    newThisWeek: number;
    applied: number;
    responded: number;
    responseRate: number | null;
  };
  contacts: { total: number; byStatus: Record<string, number>; vitAlumni: number };
  sync: {
    sources: { source: string; status: string; startedAt: string; completedAt: string | null; fetchedCount: number; newCount: number; errorMessage: string | null; failuresLast24h: number }[];
    failuresLast24h: number;
  };
  gmail: { connected: boolean; status: string; email: string | null; lastSyncedAt: string | null };
  wellfound: {
    lastRun: { mode: string; status: string; startedAt: string; endedAt: string | null; submittedCount: number; error: string | null } | null;
  };
  resumes: { count: number; defaultLabel: string | null };
};

const STAGE_ORDER = ["BOOKMARKED", "APPLYING", "APPLIED", "INTERVIEWING", "OFFERED", "REJECTED", "ARCHIVED"];

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function pretty(key: string): string {
  return key.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

/** Label/count rows with a proportional bar; sorted by count unless `order` is given. */
function Breakdown({ title, counts, order, empty }: { title: string; counts: Record<string, number>; order?: string[]; empty: string }) {
  const entries = Object.entries(counts);
  const sorted = order
    ? entries.sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99))
    : entries.sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h4 className="text-xs font-bold text-slate-700 mb-2">{title}</h4>
      {sorted.length === 0 ? (
        <p className="text-xs text-slate-400">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {sorted.map(([key, n]) => (
            <li key={key} className="text-xs">
              <div className="flex justify-between text-slate-600">
                <span className="truncate">{pretty(key)}</span>
                <span className="font-semibold tabular-nums text-slate-800">{n}</span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full mt-0.5">
                <div className="h-1.5 bg-indigo-500 rounded-full" style={{ width: `${(n / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusDot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  const cls = ok ? "bg-emerald-500" : warn ? "bg-amber-500" : "bg-rose-500";
  return <span className={`inline-block w-2 h-2 rounded-full ${cls}`} aria-hidden />;
}

export default function SystemOverview({ refreshKey = 0 }: { refreshKey?: number }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<Overview>("/api/overview")
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (error) {
    return (
      <div role="alert" className="p-3 rounded-xl text-sm bg-rose-50 text-rose-800 border border-rose-200">
        Couldn&apos;t load the system overview: {error}
      </div>
    );
  }
  if (!data) return <div className="text-sm text-slate-400 py-6">Loading overview…</div>;

  const { jobs, applications, contacts, sync, gmail, wellfound } = data;
  const rate = applications.responseRate == null ? "—" : `${Math.round(applications.responseRate * 100)}%`;
  const run = wellfound.lastRun;

  return (
    <section aria-label="System overview" className="space-y-3">
      <h3 className="font-bold text-slate-900">System overview</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat label="Active jobs" value={jobs.active} sub={`${jobs.internships} internships · ${jobs.saved} saved`} />
        <Stat label="Strong matches" value={jobs.apply} sub={`${jobs.review} to review`} />
        <Stat label="Posted ≤ 3 days" value={jobs.freshness.within3d} sub={`${jobs.freshness.within7d} more this week`} />
        <Stat label="Applied" value={applications.applied} sub={`${applications.newThisWeek} this week`} />
        <Stat label="Response rate" value={rate} sub={`${applications.responded} of ${applications.applied} heard back`} />
        <Stat label="Contacts" value={contacts.total} sub={`${contacts.vitAlumni} VIT alumni`} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <Breakdown title="Active jobs by source" counts={jobs.bySource} empty="No active jobs yet — sync sources in Job Discovery." />
        <Breakdown
          title="Freshness"
          counts={{ "≤ 3 days": jobs.freshness.within3d, "4–7 days": jobs.freshness.within7d, "8–30 days": jobs.freshness.within30d, Older: jobs.freshness.older }}
          order={["≤ 3 days", "4–7 days", "8–30 days", "Older"]}
          empty="No active jobs."
        />
        <Breakdown title="Applications by stage" counts={applications.byStage} order={STAGE_ORDER} empty="No applications tracked yet." />
        <Breakdown title="Contacts by status" counts={contacts.byStatus} empty="No contacts yet." />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4 md:col-span-1">
          <h4 className="text-xs font-bold text-slate-700 mb-2">
            Last sync per source{sync.failuresLast24h ? <span className="ml-1 text-rose-600">· {sync.failuresLast24h} failed in 24h</span> : null}
          </h4>
          {sync.sources.length === 0 ? (
            <p className="text-xs text-slate-400">No syncs have run.</p>
          ) : (
            <ul className="space-y-1 max-h-48 overflow-y-auto">
              {sync.sources.map((s) => (
                <li key={s.source} className="flex items-center gap-2 text-xs" title={s.errorMessage || undefined}>
                  <StatusDot ok={s.status === "SUCCESS"} warn={s.status === "RUNNING" || s.status === "PARTIAL" || s.status === "SKIPPED"} />
                  <span className="truncate flex-1 text-slate-700">{s.source}</span>
                  <span className="text-slate-500 whitespace-nowrap">{timeAgo(s.startedAt)}</span>
                  {s.failuresLast24h > 0 && <span className="text-rose-600 font-semibold">{s.failuresLast24h}✗</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h4 className="text-xs font-bold text-slate-700 mb-2">Gmail</h4>
          <p className="text-sm flex items-center gap-2">
            <StatusDot ok={gmail.connected} />
            {gmail.connected ? `Connected${gmail.email ? ` as ${gmail.email}` : ""}` : gmail.status === "NOT_CONNECTED" ? "Not connected" : pretty(gmail.status)}
          </p>
          <p className="text-xs text-slate-500 mt-1">Last synced {timeAgo(gmail.lastSyncedAt)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h4 className="text-xs font-bold text-slate-700 mb-2">Wellfound auto-apply</h4>
          {run ? (
            <>
              <p className="text-sm flex items-center gap-2">
                <StatusDot ok={run.status === "SUCCEEDED"} warn={run.status === "RUNNING" || run.status === "STARTING" || run.status === "STOPPED"} />
                {pretty(run.status)} · {run.mode === "LIVE" ? "live" : "dry run"}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {timeAgo(run.startedAt)} · {run.submittedCount} submitted
              </p>
              {run.error && <p className="text-xs text-rose-600 mt-1 truncate" title={run.error}>{run.error}</p>}
            </>
          ) : (
            <p className="text-xs text-slate-400">No runs yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}
