"use client";

import React, { useCallback, useEffect, useState } from "react";
import { api, ApiError, errorMessage } from "@/lib/api";
import RunLog from "./RunLog";
import { Card, Notice, NoticeBanner, PreflightList } from "./ui";
import { Preflight, RunMode, WellfoundOverview, WellfoundRun, isActiveStatus } from "./types";

interface Props {
  overview: WellfoundOverview | null;
  onChanged: () => void;
}

export default function RunPanel({ overview, onChanged }: Props) {
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [checking, setChecking] = useState(false);
  const [mode, setMode] = useState<RunMode>("DRY_RUN");
  const [visible, setVisible] = useState(true);
  const [trace, setTrace] = useState(false);
  const [batch, setBatch] = useState(1);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [startedRunId, setStartedRunId] = useState<string | null>(null);

  const activeRun = overview?.activeRun || null;
  const shownRunId = activeRun?.id || startedRunId || overview?.lastRun?.id || null;
  const running = isActiveStatus(activeRun?.status);
  const stats = overview?.stats;
  const effectiveBatch = mode === "LIVE" && stats ? Math.min(batch, stats.remainingToday) : batch;

  const runPreflight = useCallback(async () => {
    setChecking(true);
    try {
      setPreflight(await api<Preflight>("/api/wellfound/preflight"));
    } catch (err) {
      setNotice({ type: "error", text: `Preflight request failed: ${errorMessage(err)}` });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setPreflight(await api<Preflight>("/api/wellfound/preflight"));
      } catch (err) {
        setNotice({ type: "error", text: `Preflight request failed: ${errorMessage(err)}` });
      }
    })();
  }, []);

  const start = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await api<{ run: WellfoundRun }>("/api/wellfound/runs", {
        method: "POST",
        body: { mode, visible, max: batch, trace, confirmLive: mode === "LIVE" ? true : undefined },
      });
      setStartedRunId(res.run.id);
      setConfirming(false);
      setConfirmText("");
      setNotice({
        type: "info",
        text: `${mode === "LIVE" ? "Live" : "Dry"} run started (batch ${res.run.maxApplications}). Logs stream below.`,
      });
      onChanged();
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { preflight?: Preflight; runId?: string } | undefined) : undefined;
      if (body?.preflight) setPreflight(body.preflight);
      if (body?.runId) setStartedRunId(body.runId);
      setNotice({ type: "error", text: errorMessage(err) });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!activeRun) return;
    setBusy(true);
    try {
      await api(`/api/wellfound/runs/${activeRun.id}/stop`, { method: "POST" });
      setNotice({ type: "info", text: "Stop requested. The runner closes Chrome and exits." });
      onChanged();
    } catch (err) {
      setNotice({ type: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const onStartClick = () => {
    if (mode === "LIVE") setConfirming(true);
    else void start();
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
      <div className="xl:col-span-2 space-y-6">
        <Card
          title="Preflight"
          actions={
            <button onClick={runPreflight} disabled={checking} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">
              {checking ? "Checking…" : "Re-check"}
            </button>
          }
        >
          {preflight ? (
            <>
              <p className={`text-xs font-semibold ${preflight.ok ? "text-emerald-700" : "text-rose-700"}`}>
                {preflight.ok ? "Ready to run" : "Not ready — fix the items marked ✕"} · runner: {preflight.executor === "agent" ? "host agent" : "this machine"}
              </p>
              <PreflightList checks={preflight.checks} />
            </>
          ) : (
            <p className="text-sm text-slate-500">Checking the runner environment…</p>
          )}
        </Card>

        <Card title="Start a run">
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Mode</legend>
            <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${mode === "DRY_RUN" ? "border-indigo-300 bg-indigo-50/50" : "border-slate-200"}`}>
              <input type="radio" name="wf-mode" checked={mode === "DRY_RUN"} onChange={() => { setMode("DRY_RUN"); setConfirming(false); }} className="mt-1" />
              <span>
                <span className="block text-sm font-semibold text-slate-900">Dry run</span>
                <span className="block text-xs text-slate-500">Opens jobs and fills the forms, never presses Apply. Nothing is recorded.</span>
              </span>
            </label>
            <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${mode === "LIVE" ? "border-amber-300 bg-amber-50/60" : "border-slate-200"}`}>
              <input type="radio" name="wf-mode" checked={mode === "LIVE"} onChange={() => setMode("LIVE")} className="mt-1" />
              <span>
                <span className="block text-sm font-semibold text-slate-900">Live</span>
                <span className="block text-xs text-slate-500">Submits real applications from your Wellfound account and logs them to applications.csv.</span>
              </span>
            </label>
          </fieldset>

          <div className="grid grid-cols-2 gap-4">
            <label className="block text-xs font-semibold text-slate-600">
              Batch size
              <input
                type="number"
                min={1}
                max={50}
                value={batch}
                onChange={(e) => setBatch(Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1)))}
                className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
              />
              {mode === "LIVE" && stats && (
                <span className="block mt-1 font-normal text-slate-500">
                  Will apply to at most {effectiveBatch} ({stats.remainingToday} left of today&apos;s cap {stats.dailyCap})
                </span>
              )}
            </label>
            <div className="space-y-2 pt-5">
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
                Show the Chrome window
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input type="checkbox" checked={trace} onChange={(e) => setTrace(e.target.checked)} />
                Record a Playwright trace
              </label>
            </div>
          </div>

          {confirming && mode === "LIVE" && (
            <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 space-y-3">
              <p className="text-sm text-amber-900">
                This will submit up to <strong>{effectiveBatch}</strong> real application{effectiveBatch === 1 ? "" : "s"} on Wellfound under your name.
                They cannot be withdrawn from here. Run a dry run first if you changed anything.
              </p>
              <label className="block text-xs font-semibold text-amber-900">
                Type APPLY to confirm
                <input
                  aria-label="Type APPLY to confirm"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  className="mt-1 w-full px-3 py-2 text-sm border border-amber-300 rounded-lg bg-white"
                />
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => void start()}
                  disabled={busy || confirmText.trim() !== "APPLY" || effectiveBatch <= 0}
                  className="px-4 py-2 text-xs font-bold rounded-lg bg-amber-600 text-white disabled:opacity-40"
                >
                  Submit applications
                </button>
                <button onClick={() => { setConfirming(false); setConfirmText(""); }} className="px-4 py-2 text-xs font-semibold rounded-lg bg-white border border-slate-200 text-slate-700">
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            {running ? (
              <button onClick={stop} disabled={busy} className="flex-1 px-4 py-2.5 text-sm font-bold rounded-xl bg-rose-600 hover:bg-rose-700 text-white">
                Stop run
              </button>
            ) : (
              !confirming && (
                <button
                  onClick={onStartClick}
                  disabled={busy || (mode === "LIVE" && effectiveBatch <= 0)}
                  className={`flex-1 px-4 py-2.5 text-sm font-bold rounded-xl text-white disabled:opacity-40 ${
                    mode === "LIVE" ? "bg-amber-600 hover:bg-amber-700" : "bg-indigo-600 hover:bg-indigo-700"
                  }`}
                >
                  {busy ? "Starting…" : mode === "LIVE" ? "Start live run…" : "Start dry run"}
                </button>
              )
            )}
          </div>
          {mode === "LIVE" && stats && stats.remainingToday <= 0 && (
            <p className="text-xs text-rose-700">Today&apos;s cap of {stats.dailyCap} is reached. Live runs resume after midnight IST.</p>
          )}
          <NoticeBanner notice={notice} onClose={() => setNotice(null)} />
        </Card>
      </div>

      <div className="xl:col-span-3">
        <Card title={running ? "Live log" : "Latest run log"}>
          {shownRunId ? (
            <RunLog key={shownRunId} runId={shownRunId} onEnd={() => onChanged()} />
          ) : (
            <p className="text-sm text-slate-500">No runs yet. Start with a dry run of 1 job.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
