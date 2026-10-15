"use client";

import React, { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useDeepLink } from "@/lib/urlParams";
import RunPanel from "./wellfound/RunPanel";
import HistoryPanel from "./wellfound/HistoryPanel";
import AppliedPanel from "./wellfound/AppliedPanel";
import ProfilePanel from "./wellfound/ProfilePanel";
import ZenPanel from "./wellfound/ZenPanel";
import HowToPanel from "./wellfound/HowToPanel";
import { ModeBadge, StatusBadge, formatIst } from "./wellfound/ui";
import { WellfoundOverview, isActiveStatus } from "./wellfound/types";

const TABS = [
  { id: "RUN", label: "Run" },
  { id: "HISTORY", label: "History & Diagnostics" },
  { id: "APPLIED", label: "Applied" },
  { id: "PROFILE", label: "Profile & Rules" },
  { id: "ZEN", label: "Zen script" },
  { id: "HOWTO", label: "How to use" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default function WellfoundAutoApplyManager() {
  // Deep link `?tab=WELLFOUND&id=<run>` opens History & Diagnostics on that run.
  const linkedRunId = useDeepLink("WELLFOUND")?.id ?? null;
  const [tab, setTab] = useState<TabId>(linkedRunId ? "HISTORY" : "RUN");
  const [overview, setOverview] = useState<WellfoundOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await api<WellfoundOverview>("/api/wellfound/overview"));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    void (async () => {
      await loadOverview();
    })();
  }, [loadOverview]);

  // While a run is active, keep the header (today count, status) fresh.
  const active = isActiveStatus(overview?.activeRun?.status);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void loadOverview(), 5000);
    return () => clearInterval(t);
  }, [active, loadOverview]);

  const stats = overview?.stats;
  const last = overview?.activeRun || overview?.lastRun || null;

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Wellfound auto-apply</h1>
            <p className="mt-1 text-sm text-slate-500">
              Applies to intern and fresher roles on Wellfound from your own Chrome session. Always dry-run first.
            </p>
          </div>
          <button onClick={refresh} className="self-start px-3 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700">
            Refresh
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-rose-700">Could not reach the API: {error}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Today (IST)</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span data-testid="today-count" className="text-2xl font-extrabold text-emerald-700">{stats ? stats.today : "—"}</span>
              <span className="text-xs text-slate-500">/ {stats?.dailyCap ?? "—"} daily cap</span>
            </div>
          </div>
          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total applied</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-slate-900">{stats?.totalApplications ?? "—"}</span>
              <span className="text-xs text-slate-500">live submissions</span>
            </div>
          </div>
          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">{overview?.activeRun ? "Running now" : "Last run"}</span>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              {last ? (
                <>
                  <ModeBadge mode={last.mode} />
                  <StatusBadge status={last.status} />
                  <span className="text-xs text-slate-500">{formatIst(last.startedAt)}</span>
                </>
              ) : (
                <span className="text-sm text-slate-500">none yet</span>
              )}
            </div>
          </div>
          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Runner</span>
            <div className="mt-2 text-sm font-semibold text-slate-800">
              {overview ? (overview.executor === "agent" ? "Host agent" : "This machine") : "—"}
              <span className="block text-xs font-normal text-slate-500">Gemini {overview?.geminiConfigured ? "configured" : "not set (templates)"}</span>
            </div>
          </div>
        </div>
      </div>

      <div role="tablist" className="flex gap-1 border-b border-slate-200 bg-white px-4 rounded-t-xl overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`py-3 px-4 text-xs font-bold border-b-2 whitespace-nowrap transition-all ${
              tab === t.id ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
            {t.id === "RUN" && active && <span className="ml-2 inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
          </button>
        ))}
      </div>

      {tab === "RUN" && <RunPanel overview={overview} onChanged={refresh} />}
      {tab === "HISTORY" && <HistoryPanel refreshKey={refreshKey} initialRunId={linkedRunId} />}
      {tab === "APPLIED" && <AppliedPanel refreshKey={refreshKey} onSynced={refresh} />}
      {tab === "PROFILE" && <ProfilePanel onSaved={refresh} />}
      {tab === "ZEN" && <ZenPanel />}
      {tab === "HOWTO" && <HowToPanel executor={overview?.executor} />}
    </div>
  );
}
