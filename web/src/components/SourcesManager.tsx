"use client";

import React, { useState, useEffect } from "react";

export type JobSource = {
  id: string;
  sourceType: string;
  name: string;
  boardToken: string;
  enabled: boolean;
  lastSyncedAt?: string;
  jobCount: number;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function SourcesManager({ onSyncFinished }: { onSyncFinished?: () => void }) {
  const [sources, setSources] = useState<JobSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // New source form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [sourceType, setSourceType] = useState("lever");
  const [boardToken, setBoardToken] = useState("");
  const [name, setName] = useState("");

  const fetchSources = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE_URL}/api/sources`);
      if (!res.ok) throw new Error("Failed to fetch sources");
      const data = await res.json();
      setSources(data.sources || []);
    } catch (err: any) {
      setError(err.message || "Failed to load sources");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSources();
  }, []);

  const handleToggle = async (id: string, currentEnabled: boolean) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/sources/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      if (res.ok) {
        await fetchSources();
      }
    } catch (err) {
      console.error("Error toggling source:", err);
    }
  };

  const handleSyncSource = async (id: string) => {
    try {
      setSyncingId(id);
      setActionMessage(null);
      const res = await fetch(`${API_BASE_URL}/api/sources/${id}/sync`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setActionMessage(`✓ Synced ${data.source.name}: ${data.new} new, ${data.updated} updated (${data.durationMs}ms)`);
        await fetchSources();
        if (onSyncFinished) onSyncFinished();
      } else {
        setActionMessage(`✗ Sync failed: ${data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      setActionMessage(`✗ Network error: ${err.message}`);
    } finally {
      setSyncingId(null);
    }
  };

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/sources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceType,
          boardToken: boardToken.trim().toLowerCase(),
          name: name.trim(),
        }),
      });

      if (res.ok) {
        setShowAddForm(false);
        setName("");
        setBoardToken("");
        await fetchSources();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to add source");
      }
    } catch (err) {
      console.error("Error adding source:", err);
    }
  };

  const handleDelete = async (id: string, sourceName: string) => {
    if (!confirm(`Are you sure you want to remove ${sourceName}?`)) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/sources/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchSources();
      }
    } catch (err) {
      console.error("Error deleting source:", err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Target Companies & ATS Boards</h2>
          <p className="text-sm text-slate-500 mt-1">
            Configure target employer boards across Greenhouse, Ashby, Lever, and Arbeitnow APIs.
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm transition-all shadow-md shadow-indigo-600/20"
        >
          {showAddForm ? "Cancel" : "+ Add Company Board"}
        </button>
      </div>

      {actionMessage && (
        <div
          className={`p-4 rounded-xl text-sm font-medium border ${
            actionMessage.startsWith("✓")
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-rose-50 text-rose-800 border-rose-200"
          }`}
        >
          {actionMessage}
        </div>
      )}

      {showAddForm && (
        <form
          onSubmit={handleAddSource}
          className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4"
        >
          <h3 className="font-bold text-slate-900 text-base">Track New Employer ATS Board</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">ATS Platform</label>
              <select
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value)}
                className="w-full text-sm p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
              >
                <option value="lever">Lever</option>
                <option value="greenhouse">Greenhouse</option>
                <option value="ashby">Ashby</option>
                <option value="arbeitnow">Arbeitnow (API)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Company Display Name</label>
              <input
                type="text"
                placeholder="e.g. Netflix, Stripe, Datadog"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full text-sm p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Board Slug / Identifier</label>
              <input
                type="text"
                placeholder="e.g. netflix, stripe, linear"
                value={boardToken}
                onChange={(e) => setBoardToken(e.target.value)}
                className="w-full text-sm p-2.5 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 font-medium font-mono text-xs"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm shadow-md"
            >
              Save Source
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
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-6">Company / Source</th>
                <th className="py-3 px-6">ATS Platform</th>
                <th className="py-3 px-6">Board Token</th>
                <th className="py-3 px-6">Jobs Cached</th>
                <th className="py-3 px-6">Last Sync</th>
                <th className="py-3 px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sources.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-4 px-6 font-bold text-slate-900 flex items-center gap-2">
                    <span
                      className={`inline-block w-2.5 h-2.5 rounded-full ${
                        s.enabled ? "bg-emerald-500" : "bg-slate-300"
                      }`}
                    ></span>
                    {s.name}
                  </td>
                  <td className="py-4 px-6 uppercase font-bold text-xs text-slate-500">
                    <span className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-md border border-slate-200/60">
                      {s.sourceType}
                    </span>
                  </td>
                  <td className="py-4 px-6 font-mono text-xs text-slate-600">
                    {s.boardToken || <span className="text-slate-400 italic">Global API</span>}
                  </td>
                  <td className="py-4 px-6 font-semibold text-slate-700">{s.jobCount}</td>
                  <td className="py-4 px-6 text-xs text-slate-500">
                    {s.lastSyncedAt ? new Date(s.lastSyncedAt).toLocaleString() : "Never"}
                  </td>
                  <td className="py-4 px-6 text-right space-x-2">
                    <button
                      onClick={() => handleSyncSource(s.id)}
                      disabled={syncingId === s.id}
                      className="px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded-lg text-xs transition-colors disabled:opacity-50"
                    >
                      {syncingId === s.id ? "Syncing..." : "Sync"}
                    </button>
                    <button
                      onClick={() => handleToggle(s.id, s.enabled)}
                      className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs transition-colors"
                    >
                      {s.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      onClick={() => handleDelete(s.id, s.name)}
                      className="px-2 py-1 text-slate-400 hover:text-rose-600 text-xs transition-colors"
                      title="Delete source"
                    >
                      ×
                    </button>
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
