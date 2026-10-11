"use client";

import React, { useState, useEffect } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export interface BriefingData {
  id: string;
  summaryDate: string;
  timezone: string;
  content: string;
  newApplicationsCount: number;
  interviewsCount: number;
  rejectionsCount: number;
  acceptedConnectionsCount: number;
  needsAttentionCount: number;
  generatedAt: string;
}

export default function DailyBriefing() {
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [history, setHistory] = useState<BriefingData[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const fetchBriefing = async () => {
    try {
      setLoading(true);
      const [todayRes, historyRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/briefing/today`),
        fetch(`${API_BASE_URL}/api/briefing/history`),
      ]);

      if (todayRes.ok) {
        setBriefing(await todayRes.json());
      }
      if (historyRes.ok) {
        setHistory(await historyRes.json());
      }
    } catch (err) {
      console.error("Failed to fetch briefing:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBriefing();
  }, []);

  const handleGenerateNow = async () => {
    try {
      setGenerating(true);
      const res = await fetch(`${API_BASE_URL}/api/briefing/generate`, {
        method: "POST",
      });
      if (res.ok) {
        await fetchBriefing();
      }
    } catch (err) {
      console.error("Failed to generate briefing:", err);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-slate-900 to-indigo-950 text-white rounded-2xl p-6 shadow-md border border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-xl">📰</span>
            <h2 className="text-lg font-extrabold tracking-tight">Executive Daily Briefing</h2>
            <span className="text-[11px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full">
              Automated at 8:00 PM IST
            </span>
          </div>
          <p className="text-xs text-slate-300 mt-1">
            Autonomous daily digest synthesizing Gmail inbound events, networking outreach progress, and high-fit opportunities.
          </p>
        </div>

        <button
          onClick={handleGenerateNow}
          disabled={generating}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-sm transition-all disabled:opacity-50"
        >
          {generating ? "Generating..." : "⚡ Refresh Briefing Now"}
        </button>
      </div>

      {/* Metrics Row */}
      {briefing && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div
            className={`p-4 rounded-xl border shadow-xs ${
              briefing.needsAttentionCount > 0
                ? "bg-amber-50/70 border-amber-300 text-amber-900"
                : "bg-white border-slate-200 text-slate-900"
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">
              🚨 Needs Attention
            </p>
            <p className="text-2xl font-extrabold mt-1">{briefing.needsAttentionCount}</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <p className="text-xs font-semibold uppercase tracking-wider text-purple-700">
              📅 Interview Invites (24h)
            </p>
            <p className="text-2xl font-extrabold text-slate-900 mt-1">{briefing.interviewsCount}</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
              🤝 Connections Accepted (24h)
            </p>
            <p className="text-2xl font-extrabold text-slate-900 mt-1">
              {briefing.acceptedConnectionsCount}
            </p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">
              🚀 Applications In-Flight
            </p>
            <p className="text-2xl font-extrabold text-slate-900 mt-1">
              {briefing.newApplicationsCount}
            </p>
          </div>
        </div>
      )}

      {/* Briefing Content Viewer */}
      {loading ? (
        <div className="p-12 text-center text-slate-400 text-xs">Loading daily briefing...</div>
      ) : !briefing ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <p className="text-xs text-slate-500">No briefing available. Click "Refresh Briefing Now" to generate today's briefing.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-xs">
          <div className="prose prose-sm max-w-none text-slate-800 leading-relaxed whitespace-pre-wrap font-sans">
            {briefing.content}
          </div>
        </div>
      )}

      {/* History Drawer */}
      {history.length > 1 && (
        <div className="bg-slate-50 rounded-xl border border-slate-200 p-5">
          <h4 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider mb-3">
            Past Briefings
          </h4>
          <div className="flex flex-wrap gap-2">
            {history.map((h) => (
              <button
                key={h.id}
                onClick={() => setBriefing(h)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                  briefing?.id === h.id
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                }`}
              >
                {new Date(h.summaryDate).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
