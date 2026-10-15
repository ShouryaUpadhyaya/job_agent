"use client";

import React, { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { BriefingResponse } from "./briefing/types";
import { BriefingMarkdown, CountsHeader, SectionCard, StatsCard, formatDateKey, formatIstTime, linkHref } from "./briefing/ui";

export type { BriefingResponse as BriefingData } from "./briefing/types";

const TRIGGER_LABEL: Record<string, string> = {
  scheduled: "scheduled",
  manual: "regenerated",
  "on-demand": "generated on first view",
  live: "live, not saved",
};

type View = "saved" | "live";

export default function DailyBriefing() {
  const [briefing, setBriefing] = useState<BriefingResponse | null>(null);
  const [today, setToday] = useState<BriefingResponse | null>(null);
  const [history, setHistory] = useState<BriefingResponse[]>([]);
  const [view, setView] = useState<View>("saved");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"" | "generate" | "live">("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [t, h] = await Promise.all([
        api<BriefingResponse>("/api/briefing/today"),
        api<BriefingResponse[]>("/api/briefing/history", { query: { limit: 14 } }).catch(() => []),
      ]);
      setToday(t);
      setBriefing(t);
      setHistory(Array.isArray(h) ? h : []);
      setView("saved");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial fetch on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const regenerate = async () => {
    setBusy("generate");
    setError("");
    try {
      const fresh = await api<BriefingResponse>("/api/briefing/generate", { method: "POST" });
      setToday(fresh);
      setBriefing(fresh);
      setView("saved");
      setHistory((h) => [fresh, ...h.filter((x) => x.date !== fresh.date)]);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy("");
    }
  };

  const showLive = async () => {
    setBusy("live");
    setError("");
    try {
      const live = await api<BriefingResponse>("/api/briefing/live");
      setBriefing(live);
      setView("live");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy("");
    }
  };

  const showToday = () => {
    if (today) setBriefing(today);
    setView("saved");
  };

  const data = briefing?.briefing ?? null;
  const allEmpty = data ? data.sections.every((s) => s.items.length === 0) : false;
  const isPast = briefing && today && briefing.persisted && briefing.date !== today.date;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 to-indigo-950 p-6 text-white shadow-md">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight">
            <span aria-hidden>📰 </span>Daily Briefing
          </h2>
          <p className="mt-1 text-xs text-slate-300">
            {briefing ? (
              <>
                {formatDateKey(briefing.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} ·{" "}
                {formatIstTime(briefing.generatedAt)} IST ({TRIGGER_LABEL[data?.trigger ?? ""] ?? (briefing.persisted ? "saved" : "live")})
              </>
            ) : (
              "Saved automatically every evening at 8:00 PM IST."
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={view === "live" ? showToday : showLive}
            disabled={busy !== "" || loading}
            className="rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {busy === "live" ? "Loading…" : view === "live" ? "Show saved briefing" : "Live view"}
          </button>
          <button
            type="button"
            onClick={regenerate}
            disabled={busy !== "" || loading}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy === "generate" ? "Regenerating…" : "Regenerate today's briefing"}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          {error}
        </div>
      )}

      {view === "live" && (
        <p className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800">
          Live view: built from current data just now and not saved. The saved briefing is updated at 8:00 PM IST or when you regenerate.
        </p>
      )}
      {isPast && (
        <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          Showing the briefing for {formatDateKey(briefing!.date)}.{" "}
          <button type="button" className="font-bold text-indigo-700 underline" onClick={showToday}>
            Back to today
          </button>
        </p>
      )}

      {loading ? (
        <div className="p-12 text-center text-xs text-slate-400">Loading daily briefing…</div>
      ) : !briefing ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-xs text-slate-500">
          No briefing yet. Use “Regenerate today&apos;s briefing” to build one.
        </div>
      ) : (
        <>
          <CountsHeader counts={{ ...briefing, offersCount: data?.counts.offersCount }} />

          {data?.inShort.text && (
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">
                In short{data.inShort.source === "gemini" ? " · AI summary" : ""}
              </p>
              <p className="mt-1 text-sm text-slate-800">{data.inShort.text}</p>
            </div>
          )}

          {data ? (
            <>
              {allEmpty && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-700">
                  <p className="font-bold">Nothing to report yet.</p>
                  <p className="mt-1 text-xs text-slate-600">
                    The briefing fills in as you use the other tabs: add sources and review matches in{" "}
                    <a className="font-semibold text-indigo-700 underline" href={linkHref({ tab: "DISCOVERY", label: "" })}>Discovery</a>, track
                    applications in the{" "}
                    <a className="font-semibold text-indigo-700 underline" href={linkHref({ tab: "PIPELINE", label: "" })}>Pipeline</a>, save people in{" "}
                    <a className="font-semibold text-indigo-700 underline" href={linkHref({ tab: "NETWORKING", label: "" })}>Networking</a> and connect{" "}
                    <a className="font-semibold text-indigo-700 underline" href={linkHref({ tab: "GMAIL", label: "" })}>Gmail</a> for interview and
                    recruiter emails.
                  </p>
                </div>
              )}
              <div className="grid gap-4 lg:grid-cols-2">
                {data.sections.map((s) => (
                  <div key={s.key} className={s.key === "actions" ? "lg:col-span-2" : undefined}>
                    <SectionCard section={s} />
                  </div>
                ))}
                <StatsCard thisWeek={data.stats.thisWeek} lastWeek={data.stats.lastWeek} />
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
              <p className="mb-3 text-[11px] text-slate-500">Saved before briefings had sections; regenerate today&apos;s for the new layout.</p>
              <BriefingMarkdown content={briefing.content} />
            </div>
          )}
        </>
      )}

      {history.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
          <h4 className="mb-3 text-xs font-extrabold uppercase tracking-wider text-slate-700">Past briefings</h4>
          <div className="flex flex-wrap gap-2">
            {history.map((h) => (
              <button
                type="button"
                key={h.id ?? h.date}
                onClick={() => {
                  setBriefing(h);
                  setView("saved");
                }}
                aria-pressed={view === "saved" && briefing?.date === h.date}
                className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
                  view === "saved" && briefing?.date === h.date
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                }`}
              >
                {formatDateKey(h.date)}
                {h.needsAttentionCount > 0 && <span className="ml-1.5 opacity-80">· {h.needsAttentionCount}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
