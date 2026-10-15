"use client";

import React, { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { Card, Notice, NoticeBanner, formatIst } from "./ui";
import { AppliedRow } from "./types";

interface SyncResult {
  totalRows: number;
  uniqueJobs: number;
  newImported: number;
  alreadyTracked: number;
  advanced: number;
  errors: string[];
}

export default function AppliedPanel({ refreshKey, onSynced }: { refreshKey: number; onSynced: () => void }) {
  const [rows, setRows] = useState<AppliedRow[] | null>(null);
  const [today, setToday] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ applications: AppliedRow[]; today: number }>("/api/wellfound/applications");
      setRows(res.applications);
      setToday(res.today);
    } catch (e) {
      setNotice({ type: "error", text: `Could not load applications: ${errorMessage(e)}` });
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load, refreshKey]);

  const sync = async () => {
    setSyncing(true);
    try {
      const { result } = await api<{ result: SyncResult }>("/api/wellfound/sync-database", { method: "POST" });
      setNotice({
        type: result.errors.length ? "error" : "success",
        text:
          `Synced ${result.uniqueJobs} jobs (${result.totalRows} CSV rows): ${result.newImported} new, ${result.alreadyTracked} already tracked, ${result.advanced} moved to Applied.` +
          (result.errors.length ? `\n${result.errors.slice(0, 3).join("\n")}` : ""),
      });
      await load();
      onSynced();
    } catch (e) {
      setNotice({ type: "error", text: errorMessage(e) });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card
      title={`Applied on Wellfound (${rows?.length ?? 0} · ${today} today)`}
      actions={
        <button onClick={sync} disabled={syncing} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50">
          {syncing ? "Syncing…" : "Sync to pipeline"}
        </button>
      }
    >
      <p className="text-xs text-slate-500">
        From applications.csv (live submissions only). Syncing adds them to the Applications pipeline as Applied; it never moves an application backwards and creates no contacts.
      </p>
      <NoticeBanner notice={notice} onClose={() => setNotice(null)} />
      {!rows ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">No applications recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-4">Applied (IST)</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Company</th>
                <th className="py-2 pr-4">Salary</th>
                <th className="py-2 pr-4">Pipeline</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.link}-${i}`} className={`border-b border-slate-100 ${r.isToday ? "bg-emerald-50/50" : ""}`}>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {r.submittedAt ? formatIst(r.submittedAt) : r.date}
                    {r.isToday && <span className="ml-2 text-[10px] font-bold text-emerald-700">TODAY</span>}
                  </td>
                  <td className="py-2 pr-4">
                    {r.link?.startsWith("http") ? (
                      <a href={r.link.split(/\s*\|\s*/)[0]} target="_blank" rel="noreferrer" className="font-medium text-indigo-700 hover:underline">
                        {r.role}
                      </a>
                    ) : (
                      <span className="font-medium text-slate-800">{r.role}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">{r.company || <span className="text-slate-400">unknown</span>}</td>
                  <td className="py-2 pr-4 text-slate-600">{r.salary || "—"}</td>
                  <td className="py-2 pr-4 text-xs">{r.stage ? <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-semibold">{r.stage}</span> : <span className="text-slate-400">not synced</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
