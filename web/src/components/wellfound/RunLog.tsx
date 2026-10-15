"use client";

import React from "react";
import { useRunLog } from "./useRunLog";
import { LogLines, ModeBadge, StatusBadge, duration, formatIst } from "./ui";
import { WellfoundRun } from "./types";

/** Live (or replayed) log of one run. Mount with key={runId}. */
export default function RunLog({ runId, onEnd }: { runId: string; onEnd?: (run: WellfoundRun | null) => void }) {
  const { lines, run, ended, transport, error } = useRunLog(runId, onEnd);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-slate-500">
        <div className="flex items-center gap-2 flex-wrap">
          {run && <ModeBadge mode={run.mode} />}
          {run && <StatusBadge status={run.status} />}
          {run && (
            <span>
              started {formatIst(run.startedAt)} · {duration(run.startedAt, run.endedAt)} · {run.submittedCount} {run.mode === "LIVE" ? "submitted" : "simulated"},{" "}
              {run.skippedCount} skipped, {run.errorCount} errors
            </span>
          )}
        </div>
        <span>
          {ended ? "log complete" : transport === "sse" ? "● live (stream)" : transport === "polling" ? "● live (polling)" : "connecting…"}
        </span>
      </div>
      {run?.error && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{run.error}</div>}
      {error && !ended && <div className="text-xs text-amber-700">Log fetch problem: {error} (retrying)</div>}
      <LogLines lines={lines} emptyText={ended ? "This run wrote no log lines." : "Waiting for output…"} />
    </div>
  );
}
