"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import FilterSidebar from "./discovery/FilterSidebar";
import JobCard from "./discovery/JobCard";
import JobDetail from "./discovery/JobDetail";
import SearchElsewhere from "./discovery/SearchElsewhere";
import AddJobModal from "./discovery/AddJobModal";
import SourcesDrawer from "./discovery/SourcesDrawer";
import { DEFAULT_FILTERS, Facets, Filters, Job, JobsPage, Profile, filtersToQuery } from "./discovery/types";

const PAGE_SIZE = 25;

type SyncResponse = { message?: string; summary?: { totalNew?: number; totalUpdated?: number } };

export default function JobDiscovery({
  refreshKey = 0,
  initialSourcesOpen = false,
}: {
  refreshKey?: number;
  /** Opens the Manage sources drawer (used by old `?tab=SOURCES` links). */
  initialSourcesOpen?: boolean;
}) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const requestId = useRef(0);
  const [showSources, setShowSources] = useState(initialSourcesOpen);
  const [prevInitialSources, setPrevInitialSources] = useState(initialSourcesOpen);
  if (initialSourcesOpen !== prevInitialSources) {
    setPrevInitialSources(initialSourcesOpen);
    if (initialSourcesOpen) setShowSources(true);
  }
  const closeSources = useCallback(() => {
    setShowSources(false);
    setReload((r) => r + 1);
  }, []);
  const sourcesSynced = useCallback(() => setReload((r) => r + 1), []);

  const loadFacets = useCallback(() => {
    api<Facets>("/api/jobs/facets")
      .then(setFacets)
      .catch(() => setFacets(null));
  }, []);

  useEffect(() => {
    api<Profile>("/api/profiles")
      .then(setProfile)
      .catch(() => setProfile(null));
  }, [refreshKey]);

  useEffect(() => {
    loadFacets();
  }, [loadFacets, refreshKey, reload]);

  // First page whenever filters change (debounced for typing) or data is refreshed.
  useEffect(() => {
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await api<JobsPage>("/api/jobs", { query: filtersToQuery(filters, 1, PAGE_SIZE) });
        if (id !== requestId.current) return;
        setJobs(data.jobs);
        setTotal(data.total);
        setHasMore(data.hasMore);
        setPage(1);
      } catch (err) {
        if (id === requestId.current) setError(errorMessage(err));
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [filters, refreshKey, reload]);

  const loadMore = async () => {
    try {
      setLoadingMore(true);
      const data = await api<JobsPage>("/api/jobs", { query: filtersToQuery(filters, page + 1, PAGE_SIZE) });
      setJobs((prev) => [...prev, ...data.jobs.filter((j) => !prev.some((p) => p.id === j.id))]);
      setTotal(data.total);
      setHasMore(data.hasMore);
      setPage(page + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const setUserStatus = async (job: Job, userStatus: "NONE" | "SAVED" | "DISMISSED") => {
    try {
      await api(`/api/jobs/${job.id}/user-status`, { method: "PATCH", body: { userStatus } });
      setJobs((prev) =>
        userStatus === "DISMISSED" && !filters.showDismissed
          ? prev.filter((j) => j.id !== job.id)
          : prev.map((j) => (j.id === job.id ? { ...j, userStatus } : j))
      );
      if (userStatus === "DISMISSED" && !filters.showDismissed) {
        setTotal((t) => Math.max(0, t - 1));
        if (selectedId === job.id) setSelectedId(null);
      }
      loadFacets();
    } catch (err) {
      setMessage(`✗ ${errorMessage(err)}`);
    }
  };

  const runSync = async () => {
    try {
      setSyncing(true);
      setMessage(null);
      const data = await api<SyncResponse>("/api/sync", { body: { force: true } });
      setMessage(`Sync complete: ${data.summary?.totalNew || 0} new, ${data.summary?.totalUpdated || 0} updated`);
      setReload((r) => r + 1);
    } catch (err) {
      setMessage(`Sync failed: ${errorMessage(err)}`);
    } finally {
      setSyncing(false);
    }
  };

  const selected = jobs.find((j) => j.id === selectedId) || null;
  const targetText = profile
    ? [profile.targetRole, profile.targetGradYear ? `${profile.targetGradYear} grad` : null, profile.school].filter(Boolean).join(" · ")
    : "";

  return (
    <div className="flex flex-1 overflow-hidden">
      <FilterSidebar filters={filters} facets={facets} onChange={setFilters} />

      <div className="w-[26rem] shrink-0 border-r border-gray-200 bg-white overflow-y-auto flex flex-col">
        <header className="p-4 border-b border-gray-200 sticky top-0 bg-white z-10 space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold tracking-tight text-gray-900">Job Feed</h1>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSources(true)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white hover:bg-gray-50 text-gray-700 border border-gray-300"
              >
                Manage sources
              </button>
              <button
                onClick={() => setShowAdd(true)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200"
              >
                + Add job
              </button>
              <button
                onClick={runSync}
                disabled={syncing}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
              >
                {syncing ? "Syncing…" : "Sync Jobs"}
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-gray-500 gap-2">
            <span className="truncate" title={targetText}>{targetText ? `Target: ${targetText}` : " "}</span>
            <span className="font-semibold text-gray-700 whitespace-nowrap">{total} listings</span>
          </div>
          {message && <div className="p-2 text-xs bg-blue-50 text-blue-700 rounded-md border border-blue-200">{message}</div>}
          <div className="flex gap-2">
            <input
              type="search"
              placeholder="Search title, company, location or tech..."
              aria-label="Search jobs"
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              aria-label="Sort"
              value={filters.sort}
              onChange={(e) => setFilters({ ...filters, sort: e.target.value as Filters["sort"] })}
              className="px-2 text-xs font-semibold border border-gray-200 rounded-lg bg-gray-50"
            >
              <option value="best">Best match</option>
              <option value="newest">Newest</option>
              <option value="company">Company</option>
            </select>
          </div>
          <button onClick={() => setSelectedId(null)} className="text-[11px] font-semibold text-indigo-600 hover:underline">
            🔎 Search elsewhere (LinkedIn, Naukri, X…)
          </button>
        </header>

        {loading && (
          <div className="p-8 text-center" data-testid="loading-state">
            <div className="inline-block h-6 w-6 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
            <p className="mt-4 text-gray-500 text-sm">Loading jobs...</p>
          </div>
        )}

        {!loading && error && (
          <div className="p-8 text-center" data-testid="error-state">
            <p className="text-red-600 font-medium text-sm">{error}</p>
            <button onClick={() => setReload((r) => r + 1)} className="mt-4 px-4 py-2 bg-red-50 text-red-600 rounded-md text-sm font-medium hover:bg-red-100">
              Try again
            </button>
          </div>
        )}

        {!loading && !error && jobs.length === 0 && (
          <div className="p-8 text-center" data-testid="empty-state">
            <p className="text-gray-500 text-sm">No jobs match these filters.</p>
            <button onClick={runSync} className="mt-3 px-4 py-2 text-xs font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700">
              Run sync
            </button>
          </div>
        )}

        {!loading && !error && jobs.length > 0 && (
          <>
            <ul className="divide-y divide-gray-100">
              {jobs.map((job) => (
                <JobCard key={job.id} job={job} selected={job.id === selectedId} onSelect={(j) => setSelectedId(j.id)} onUserStatus={setUserStatus} />
              ))}
            </ul>
            {hasMore && (
              <div className="p-4 text-center">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-50"
                >
                  {loadingMore ? "Loading…" : `Load more (${jobs.length} of ${total})`}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex-1 bg-gray-50 overflow-y-auto">
        {selected ? (
          <JobDetail
            key={selected.id}
            job={selected}
            profile={profile}
            onUserStatus={setUserStatus}
            onPipelineChanged={() => setReload((r) => r + 1)}
          />
        ) : (
          <SearchElsewhere />
        )}
      </div>

      {showSources && <SourcesDrawer onClose={closeSources} onSyncFinished={sourcesSynced} />}

      {showAdd && (
        <AddJobModal
          onClose={() => setShowAdd(false)}
          onImported={(msg) => {
            setShowAdd(false);
            setMessage(msg);
            setReload((r) => r + 1);
          }}
        />
      )}
    </div>
  );
}
