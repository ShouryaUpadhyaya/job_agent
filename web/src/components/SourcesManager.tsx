"use client";

import React, { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";

export type JobSource = {
  id: string;
  sourceType: string;
  name: string;
  boardToken: string;
  enabled: boolean;
  lastSyncedAt?: string | null;
  jobCount: number;
  supported?: boolean;
  unsupportedReason?: string | null;
  lastRun?: {
    status: string;
    startedAt: string;
    completedAt?: string | null;
    fetchedCount: number;
    newCount: number;
    errorMessage?: string | null;
  } | null;
};

type SourceType = { type: string; label: string; tokenLabel: string; tokenRequired: boolean; example: string };

const FALLBACK_TYPES: SourceType[] = [
  { type: "greenhouse", label: "Greenhouse", tokenLabel: "Board token", tokenRequired: true, example: "stripe" },
  { type: "lever", label: "Lever", tokenLabel: "Company slug", tokenRequired: true, example: "meesho" },
  { type: "ashby", label: "Ashby", tokenLabel: "Org slug", tokenRequired: true, example: "sarvam" },
];

type SyncResult = { source: JobSource; new: number; updated: number; closed?: number; durationMs: number; skipped?: boolean; message?: string };

function RunBadge({ source }: { source: JobSource }) {
  if (source.supported === false) {
    return <span className="text-[11px] font-semibold text-slate-500" title={source.unsupportedReason || ""}>Not supported</span>;
  }
  const run = source.lastRun;
  if (!run) return <span className="text-[11px] text-slate-400">Never synced</span>;
  const tone =
    run.status === "SUCCESS"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : run.status === "FAILED"
      ? "bg-rose-50 text-rose-700 border-rose-200"
      : "bg-sky-50 text-sky-700 border-sky-200";
  return (
    <div>
      <span className={`px-2 py-0.5 text-[10px] font-bold rounded border ${tone}`}>{run.status}</span>
      {run.status === "FAILED" && run.errorMessage && (
        <p className="mt-1 text-[10px] text-rose-600 max-w-[14rem] truncate" title={run.errorMessage}>
          {run.errorMessage}
        </p>
      )}
      {run.status === "SUCCESS" && <p className="mt-1 text-[10px] text-slate-500">{run.fetchedCount} fetched · {run.newCount} new</p>}
    </div>
  );
}

export default function SourcesManager({ onSyncFinished }: { onSyncFinished?: () => void }) {
  const [sources, setSources] = useState<JobSource[]>([]);
  const [types, setTypes] = useState<SourceType[]>(FALLBACK_TYPES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [sourceType, setSourceType] = useState("greenhouse");
  const [boardToken, setBoardToken] = useState("");
  const [name, setName] = useState("");

  const fetchSources = useCallback(async () => {
    try {
      const data = await api<{ sources: JobSource[] }>("/api/sources");
      setSources(data.sources || []);
      setError(null);
    } catch (err) {
      setError(errorMessage(err) || "Failed to load sources");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api<{ sources: JobSource[] }>("/api/sources")
      .then((data) => setSources(data.sources || []))
      .catch((err) => setError(errorMessage(err) || "Failed to load sources"))
      .finally(() => setLoading(false));
    api<{ types: SourceType[] }>("/api/sources/types")
      .then((d) => d.types?.length && setTypes(d.types))
      .catch(() => {});
  }, []);

  const handleToggle = async (id: string, currentEnabled: boolean) => {
    try {
      await api(`/api/sources/${id}`, { method: "PATCH", body: { enabled: !currentEnabled } });
      await fetchSources();
    } catch (err) {
      setActionMessage(`✗ ${errorMessage(err)}`);
    }
  };

  const handleSyncSource = async (id: string) => {
    try {
      setSyncingId(id);
      setActionMessage(null);
      const data = await api<SyncResult>(`/api/sources/${id}/sync`, { method: "POST" });
      setActionMessage(
        data.skipped
          ? `✓ ${data.source.name}: skipped — ${data.message || "synced recently"}`
          : `✓ Synced ${data.source.name}: ${data.new} new, ${data.updated} updated${data.closed ? `, ${data.closed} closed` : ""} (${data.durationMs}ms)`
      );
      onSyncFinished?.();
    } catch (err) {
      setActionMessage(`✗ Sync failed: ${errorMessage(err)}`);
    } finally {
      setSyncingId(null);
      await fetchSources();
    }
  };

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      // Tokens keep their case (SmartRecruiters ids and feed URLs are case-sensitive).
      await api("/api/sources", { body: { sourceType, boardToken: boardToken.trim(), name: name.trim() } });
      setShowAddForm(false);
      setName("");
      setBoardToken("");
      setActionMessage(`✓ Added ${name.trim()}`);
      await fetchSources();
    } catch (err) {
      setActionMessage(`✗ ${errorMessage(err)}`);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api(`/api/sources/${id}`, { method: "DELETE" });
      setPendingDelete(null);
      await fetchSources();
    } catch (err) {
      setActionMessage(`✗ ${errorMessage(err)}`);
    }
  };

  const typeInfo = types.find((t) => t.type === sourceType);
  const labelFor = (type: string) => types.find((t) => t.type === type.toLowerCase())?.label || type;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Job sources</h2>
          <p className="text-sm text-slate-500 mt-1">
            Public job APIs (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Remotive, Remote OK, RSS/JSON feeds). LinkedIn and
            Naukri jobs come from alert emails and manual imports instead.
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm shadow-md shadow-indigo-600/20"
        >
          {showAddForm ? "Cancel" : "+ Add source"}
        </button>
      </div>

      {actionMessage && (
        <div
          className={`p-4 rounded-xl text-sm font-medium border ${
            actionMessage.startsWith("✓") ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-rose-50 text-rose-800 border-rose-200"
          }`}
        >
          {actionMessage}
        </div>
      )}

      {showAddForm && (
        <form onSubmit={handleAddSource} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-bold text-slate-900 text-base">Add a job source</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="source-type" className="block text-xs font-semibold text-slate-600 mb-1">Type</label>
              <select
                id="source-type"
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value)}
                className="w-full text-sm p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
              >
                {types.map((t) => (
                  <option key={t.type} value={t.type}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="source-name" className="block text-xs font-semibold text-slate-600 mb-1">Display name</label>
              <input
                id="source-name"
                type="text"
                placeholder="e.g. Stripe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full text-sm p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
              />
            </div>
            <div>
              <label htmlFor="source-token" className="block text-xs font-semibold text-slate-600 mb-1">{typeInfo?.tokenLabel || "Board token"}</label>
              <input
                id="source-token"
                type="text"
                placeholder={typeInfo?.example ? `e.g. ${typeInfo.example}` : ""}
                value={boardToken}
                required={typeInfo?.tokenRequired}
                onChange={(e) => setBoardToken(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-xs"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-sm">
              Cancel
            </button>
            <button type="submit" className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm shadow-md">
              Save source
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center items-center py-24">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      ) : error ? (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm">{error}</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-5">Source</th>
                <th className="py-3 px-5">Type</th>
                <th className="py-3 px-5">Token</th>
                <th className="py-3 px-5">Active jobs</th>
                <th className="py-3 px-5">Last sync</th>
                <th className="py-3 px-5">Status</th>
                <th className="py-3 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sources.map((s) => (
                <tr key={s.id} className={`hover:bg-slate-50/60 ${s.supported === false ? "opacity-60" : ""}`}>
                  <td className="py-3 px-5 font-bold text-slate-900">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full mr-2 ${s.enabled ? "bg-emerald-500" : "bg-slate-300"}`}></span>
                    {s.name}
                  </td>
                  <td className="py-3 px-5 text-xs">
                    <span className="bg-slate-100 text-slate-700 px-2 py-1 rounded-md border border-slate-200/60 font-semibold">{labelFor(s.sourceType)}</span>
                  </td>
                  <td className="py-3 px-5 font-mono text-xs text-slate-600 max-w-[12rem] truncate" title={s.boardToken}>
                    {s.boardToken || <span className="text-slate-400 italic">—</span>}
                  </td>
                  <td className="py-3 px-5 font-semibold text-slate-700">{s.jobCount}</td>
                  <td className="py-3 px-5 text-xs text-slate-500">{s.lastSyncedAt ? new Date(s.lastSyncedAt).toLocaleString() : "Never"}</td>
                  <td className="py-3 px-5">
                    <RunBadge source={s} />
                  </td>
                  <td className="py-3 px-5 text-right whitespace-nowrap space-x-2">
                    {s.supported !== false && (
                      <>
                        <button
                          onClick={() => handleSyncSource(s.id)}
                          disabled={syncingId === s.id}
                          className="px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded-lg text-xs disabled:opacity-50"
                        >
                          {syncingId === s.id ? "Syncing..." : "Sync"}
                        </button>
                        <button onClick={() => handleToggle(s.id, s.enabled)} className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs">
                          {s.enabled ? "Disable" : "Enable"}
                        </button>
                      </>
                    )}
                    {pendingDelete === s.id ? (
                      <>
                        <button onClick={() => handleDelete(s.id)} className="px-2 py-1 bg-rose-600 text-white rounded-lg text-xs font-semibold">
                          Confirm remove
                        </button>
                        <button onClick={() => setPendingDelete(null)} className="px-2 py-1 text-slate-500 text-xs">Keep</button>
                      </>
                    ) : (
                      <button onClick={() => setPendingDelete(s.id)} className="px-2 py-1 text-slate-400 hover:text-rose-600 text-xs" title={`Remove ${s.name}`}>
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
