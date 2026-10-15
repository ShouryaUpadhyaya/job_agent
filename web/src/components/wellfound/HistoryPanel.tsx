"use client";

import React, { useCallback, useEffect, useState } from "react";
import { api, buildUrl, errorMessage } from "@/lib/api";
import RunLog from "./RunLog";
import { Card, ModeBadge, StatusBadge, duration, formatIst } from "./ui";
import { DiagnosticsListing, WellfoundRun } from "./types";

const fileUrl = (runId: string, name: string) => buildUrl(`/api/wellfound/runs/${runId}/diagnostics/${encodeURIComponent(name)}`);

function Diagnostics({ runId }: { runId: string }) {
  const [data, setData] = useState<DiagnosticsListing | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<DiagnosticsListing>(`/api/wellfound/runs/${runId}/diagnostics`)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (error) return <p className="text-sm text-rose-700">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500">Loading diagnostics…</p>;
  const extras = data.files.filter((f) => !/^\d+-.+\.(png|html|json)$/i.test(f.name));
  if (!data.artifacts.length && !extras.length) {
    return <p className="text-sm text-slate-500">No diagnostics for this run. They are saved when a page is logged out, the apply modal or submit button is missing, a job errors, or the run crashes.</p>;
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {data.artifacts.map((a) => (
          <figure key={a.id} className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
            {a.screenshot ? (
              <a href={fileUrl(runId, a.screenshot)} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- runtime file served by the API */}
                <img src={fileUrl(runId, a.screenshot)} alt={`Screenshot: ${a.reason}`} className="w-full h-40 object-cover object-top bg-white" />
              </a>
            ) : (
              <div className="h-40 flex items-center justify-center text-xs text-slate-400">no screenshot</div>
            )}
            <figcaption className="p-3 space-y-1 text-xs">
              <div className="font-semibold text-slate-800">{a.reason.replace(/-/g, " ")}</div>
              {a.context?.url && <div className="text-slate-500 break-all">{a.context.url}</div>}
              {a.context?.at && <div className="text-slate-400">{formatIst(a.context.at)}</div>}
              <div className="flex gap-3 pt-1">
                {a.html && <a className="text-indigo-600 font-semibold hover:underline" href={fileUrl(runId, a.html)}>Download HTML</a>}
                {a.json && <a className="text-indigo-600 font-semibold hover:underline" href={fileUrl(runId, a.json)} target="_blank" rel="noreferrer">Context JSON</a>}
              </div>
            </figcaption>
          </figure>
        ))}
      </div>
      {extras.length > 0 && (
        <div className="text-xs text-slate-600">
          Other files:{" "}
          {extras.map((f) => (
            <a key={f.name} href={fileUrl(runId, f.name)} className="mr-3 text-indigo-600 font-semibold hover:underline">
              {f.name}
            </a>
          ))}
          {extras.some((f) => f.name === "trace.zip") && <span className="text-slate-400">(open with npx playwright show-trace trace.zip)</span>}
        </div>
      )}
    </div>
  );
}

export default function HistoryPanel({ refreshKey }: { refreshKey: number }) {
  const [runs, setRuns] = useState<WellfoundRun[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ runs: WellfoundRun[] }>("/api/wellfound/runs", { query: { limit: 50 } });
      setRuns(res.runs);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load, refreshKey]);

  const current = selected || runs?.[0]?.id || null;

  return (
    <div className="space-y-6">
      <Card
        title="Run history"
        actions={
          <button onClick={() => void load()} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">
            Refresh
          </button>
        }
      >
        {error && <p className="text-sm text-rose-700">{error}</p>}
        {!runs ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : runs.length === 0 ? (
          <p className="text-sm text-slate-500">No runs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-4">Started (IST)</th>
                  <th className="py-2 pr-4">Mode</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Done / skipped / errors</th>
                  <th className="py-2 pr-4">Duration</th>
                  <th className="py-2 pr-4">Diagnostics</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setSelected(r.id)}
                    className={`border-b border-slate-100 cursor-pointer hover:bg-slate-50 ${current === r.id ? "bg-indigo-50/60" : ""}`}
                  >
                    <td className="py-2 pr-4 whitespace-nowrap">{formatIst(r.startedAt)}</td>
                    <td className="py-2 pr-4"><ModeBadge mode={r.mode} /></td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={r.status} />
                      {r.error && <div className="text-[11px] text-rose-600 max-w-xs truncate" title={r.error}>{r.error}</div>}
                    </td>
                    <td className="py-2 pr-4">{r.submittedCount} / {r.skippedCount} / {r.errorCount}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">{duration(r.startedAt, r.endedAt)}</td>
                    <td className="py-2 pr-4">{r.diagnosticsCount ? `${r.diagnosticsCount} screenshot${r.diagnosticsCount === 1 ? "" : "s"}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {current && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Card title="Diagnostics">
            <Diagnostics key={current} runId={current} />
          </Card>
          <Card title="Log">
            <RunLog key={current} runId={current} />
          </Card>
        </div>
      )}
    </div>
  );
}
