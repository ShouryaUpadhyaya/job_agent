"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useDeepLink, useScrollToDeepLink } from "@/lib/urlParams";
import type { CompanyPeople } from "./networking";
import ApplicationCard from "./pipeline/ApplicationCard";
import KanbanBoard from "./pipeline/KanbanBoard";
import Toolbar, { View } from "./pipeline/Toolbar";
import { ApplicationPatch, PipelineApplication, PipelineFilters, PipelineStats, isStage, statusForStage } from "./pipeline/types";
import { Toast, Toasts } from "./pipeline/ui";

export type { PipelineApplication as Application } from "./pipeline/types";

const DEFAULT_FILTERS: PipelineFilters = { q: "", stages: [], source: "", hasAlumni: false, sort: "fit" };

/**
 * Application pipeline: server-side filtering and sorting (fit, match, alumni…), list or board
 * view, and optimistic edits that roll back with an inline error if the server refuses.
 */
export default function ApplicationsPipeline() {
  const [applications, setApplications] = useState<PipelineApplication[]>([]);
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [filters, setFilters] = useState<PipelineFilters>(DEFAULT_FILTERS);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>("list");
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadedKey, setLoadedKey] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [statsKey, setStatsKey] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const requestId = useRef(0);
  const toastId = useRef(0);
  const appsRef = useRef<PipelineApplication[]>([]);
  useEffect(() => {
    appsRef.current = applications;
  }, [applications]);

  const notify = useCallback((message: string, tone: Toast["tone"] = "error") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  // Deep link (`?tab=PIPELINE&id=…`): highlight that card. It's fetched on its own if the
  // current list doesn't include it, so filters can never hide it.
  const deepLinkId = useDeepLink("PIPELINE")?.id ?? null;
  const deepLinkTried = useRef(false);
  const deepLinkVisible = Boolean(deepLinkId && applications.some((a) => a.id === deepLinkId));
  useEffect(() => {
    if (!deepLinkId || initialLoading || deepLinkTried.current) return;
    deepLinkTried.current = true;
    if (appsRef.current.some((a) => a.id === deepLinkId)) return;
    api<PipelineApplication>(`/api/applications/${encodeURIComponent(deepLinkId)}`)
      .then((app) => {
        if (app?.id) setApplications((list) => (list.some((a) => a.id === app.id) ? list : [app, ...list]));
      })
      .catch((err) =>
        notify(err instanceof ApiError && err.status === 404 ? "That application no longer exists." : `Couldn't open the linked application: ${errorMessage(err)}`)
      );
  }, [deepLinkId, initialLoading, notify]);
  useScrollToDeepLink("application", deepLinkId, deepLinkVisible && !initialLoading);

  const loadStats = useCallback(() => setStatsKey((k) => k + 1), []);
  const reload = () => {
    setReloadKey((k) => k + 1);
    loadStats();
  };

  // The list: refetched whenever the filters change or a reload is requested. Only the very
  // first load shows the full spinner; later ones show a small "Updating…" hint.
  const requestKey = JSON.stringify({ filters, reloadKey });
  const refreshing = !initialLoading && loadedKey !== requestKey;
  useEffect(() => {
    const id = ++requestId.current;
    const f = filters;
    api<PipelineApplication[]>("/api/applications", {
      query: { q: f.q, stage: f.stages, source: f.source, hasAlumni: f.hasAlumni || undefined, sort: f.sort },
    })
      .then((data) => {
        if (id !== requestId.current) return;
        setApplications(Array.isArray(data) ? data : []);
        setLoadError(null);
      })
      .catch((err) => {
        if (id === requestId.current) setLoadError(errorMessage(err));
      })
      .finally(() => {
        if (id !== requestId.current) return;
        setLoadedKey(JSON.stringify({ filters: f, reloadKey }));
        setInitialLoading(false);
      });
  }, [filters, reloadKey]);

  useEffect(() => {
    api<PipelineStats>("/api/applications/stats")
      .then(setStats)
      .catch(() => undefined); // Counts are decorative; the list itself reports errors.
  }, [statsKey]);

  // Debounce the search box into the filters.
  useEffect(() => {
    if (search === filters.q) return;
    const t = setTimeout(() => setFilters((f) => ({ ...f, q: search })), 300);
    return () => clearTimeout(t);
  }, [search, filters.q]);

  const replaceApp = (id: string, next: PipelineApplication) =>
    setApplications((list) => list.map((a) => (a.id === id ? next : a)));

  const patchApplication = async (id: string, patch: ApplicationPatch) => {
    const before = appsRef.current.find((a) => a.id === id);
    if (!before) return;
    if (patch.stage !== undefined && !isStage(patch.stage)) return;
    const optimistic: PipelineApplication = {
      ...before,
      ...patch,
      ...(patch.stage && isStage(patch.stage) ? { status: statusForStage(patch.stage) } : {}),
    };
    replaceApp(id, optimistic);
    try {
      const saved = await api<PipelineApplication>(`/api/applications/${id}`, { method: "PATCH", body: patch });
      // Keep the card in place; the server copy carries the recomputed fit and dates.
      setApplications((list) => list.map((a) => (a.id === id ? (saved?.job ? { ...saved, people: a.people } : { ...a, ...patch }) : a)));
      if (patch.stage !== undefined) loadStats();
    } catch (err) {
      setApplications((list) => list.map((a) => (a.id === id ? before : a)));
      notify(`Couldn't update "${before.job.title}": ${errorMessage(err)}`);
    }
  };

  const deleteApplication = async (id: string) => {
    const index = appsRef.current.findIndex((a) => a.id === id);
    const removed = appsRef.current[index];
    if (!removed) return;
    setApplications((list) => list.filter((a) => a.id !== id));
    try {
      await api(`/api/applications/${id}`, { method: "DELETE" });
      loadStats();
    } catch (err) {
      setApplications((list) => {
        const copy = list.filter((a) => a.id !== id);
        copy.splice(Math.min(index, copy.length), 0, removed);
        return copy;
      });
      notify(`Couldn't remove "${removed.job.title}": ${errorMessage(err)}`);
    }
  };

  /** After a contact is added/changed from a card, refresh people for that company only. */
  const refreshPeople = async (companyKey: string) => {
    try {
      const res = await api<Record<string, CompanyPeople>>("/api/networking/by-company", { query: { keys: companyKey } });
      const people = res[companyKey];
      if (!people) return;
      setApplications((list) =>
        list.map((a) => (a.companyKey === companyKey ? { ...a, people: { ...a.people, ...people } } : a))
      );
    } catch (err) {
      notify(`Couldn't refresh people: ${errorMessage(err)}`);
    }
  };

  const updateFilters = (patch: Partial<PipelineFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const filtersActive =
    filters.q !== "" || filters.stages.length > 0 || filters.source !== "" || filters.hasAlumni;

  if (initialLoading) {
    return (
      <div className="flex justify-center items-center py-24" role="status" aria-label="Loading applications">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-3 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Application Pipeline</h2>
          <p className="text-sm text-slate-500 mt-1">
            Every job you&rsquo;re pursuing, ranked by fit, with the people who can refer you.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {refreshing && <span className="text-xs text-slate-400" role="status">Updating…</span>}
          <button
            type="button"
            onClick={reload}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-sm transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      <Toolbar filters={filters} search={search} onSearch={setSearch} onChange={updateFilters} stats={stats} view={view} onView={setView} />

      {loadError && (
        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm flex justify-between gap-3" role="alert">
          <span>Couldn&rsquo;t load applications: {loadError}</span>
          <button type="button" onClick={reload} className="font-semibold underline">
            Retry
          </button>
        </div>
      )}

      {applications.length === 0 && !loadError ? (
        filtersActive ? (
          <div className="bg-white p-10 text-center rounded-2xl border border-slate-100 shadow-sm">
            <h3 className="text-base font-bold text-slate-800">No applications match these filters</h3>
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setFilters((f) => ({ ...DEFAULT_FILTERS, sort: f.sort }));
              }}
              className="mt-3 px-3 py-1.5 text-sm font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="bg-white p-12 text-center rounded-2xl border border-slate-100 shadow-sm">
            <h3 className="text-lg font-bold text-slate-800">No Applications Tracked Yet</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto mt-2">
              Open Job Discovery, pick a listing and use &ldquo;Save to Pipeline&rdquo;. Wellfound runs and Gmail updates show up here too.
            </p>
          </div>
        )
      ) : view === "kanban" ? (
        <KanbanBoard
          applications={applications}
          highlightedId={deepLinkId}
          stages={filters.stages}
          onPatch={patchApplication}
          onDelete={deleteApplication}
          onPeopleChanged={refreshPeople}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {applications.map((app) => (
            <ApplicationCard
              key={app.id}
              app={app}
              highlighted={app.id === deepLinkId}
              onPatch={patchApplication}
              onDelete={deleteApplication}
              onPeopleChanged={refreshPeople}
            />
          ))}
        </div>
      )}

      <Toasts toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}
