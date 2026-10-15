"use client";

import React, { useCallback, useEffect, useState } from "react";
import { api, ApiError, errorMessage } from "../lib/api";
import {
  ConnectionCard,
  DEFAULT_FILTERS,
  DemoTools,
  EmailEvent,
  EventFilters,
  EventsList,
  GmailStatus,
  GmailSummary,
  SummaryPanel,
  SyncStats,
} from "./gmail";

export type { EmailEvent, GmailStatus } from "./gmail";

type Banner = { tone: "success" | "error"; text: string } | null;

function fixFrom(err: unknown): string | undefined {
  if (err instanceof ApiError && err.body && typeof err.body === "object" && "fix" in err.body) {
    const fix = (err.body as { fix?: unknown }).fix;
    return typeof fix === "string" ? fix : undefined;
  }
  return undefined;
}

export default function GmailSync() {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [summary, setSummary] = useState<GmailSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [events, setEvents] = useState<EmailEvent[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [filters, setFilters] = useState<EventFilters>(DEFAULT_FILTERS);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<SyncStats | null>(null);
  const [syncError, setSyncError] = useState<{ message: string; fix?: string } | null>(null);
  const [banner, setBanner] = useState<Banner>(null);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api<GmailStatus>("/api/gmail/status"));
    } catch (err) {
      setBanner({ tone: "error", text: `Could not load Gmail status: ${errorMessage(err)}` });
    }
  }, []);

  // Bumped after a sync, disconnect or demo change to refetch summary, status and events.
  const [reloadKey, setReloadKey] = useState(0);
  const reloadAll = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    api<GmailStatus>("/api/gmail/status", { signal: controller.signal })
      .then(setStatus)
      .catch((err) => {
        if (!controller.signal.aborted) setBanner({ tone: "error", text: `Could not load Gmail status: ${errorMessage(err)}` });
      });
    api<GmailSummary>("/api/gmail/summary", { query: { days: 7 }, signal: controller.signal })
      .then((s) => {
        setSummary(s);
        setSummaryError(null);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setSummaryError(errorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setSummaryLoading(false);
      });
    return () => controller.abort();
  }, [reloadKey]);

  // Events refetch on filter change; aborting the previous request keeps a slow, stale
  // response from overwriting a newer one.
  useEffect(() => {
    const controller = new AbortController();
    api<EmailEvent[]>("/api/gmail/events", {
      query: {
        classification: filters.classification === "ALL" ? undefined : filters.classification,
        importance: filters.importance === "ALL" ? undefined : filters.importance,
        linked: filters.linked === "ALL" ? undefined : filters.linked,
        demo: filters.demo,
        limit: 100,
      },
      signal: controller.signal,
    })
      .then((rows) => {
        setEvents(rows);
        setEventsError(null);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setEventsError(errorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setEventsLoading(false);
      });
    return () => controller.abort();
  }, [filters, reloadKey]);

  const changeFilters = (f: EventFilters) => {
    setEventsLoading(true);
    setFilters(f);
  };

  // Result of the Google OAuth redirect (?tab=GMAIL&auth=success|error&reason=…), shown once.
  useEffect(() => {
    const url = new URL(window.location.href);
    const auth = url.searchParams.get("auth");
    if (!auth) return;
    const reason = url.searchParams.get("reason") || url.searchParams.get("error");
    // Read after hydration (the server render has no URL), so a one-off sync setState is intended.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBanner(
      auth === "success"
        ? { tone: "success", text: "Gmail connected. Run a sync to pull in your job emails." }
        : { tone: "error", text: `Gmail connection failed${reason ? `: ${reason}` : "."}` }
    );
    url.searchParams.delete("auth");
    url.searchParams.delete("reason");
    url.searchParams.delete("error");
    window.history.replaceState(null, "", url.toString());
  }, []);

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>("/api/gmail/auth-url");
      window.location.assign(url);
    } catch (err) {
      setBanner({ tone: "error", text: `${errorMessage(err)}${fixFrom(err) ? ` ${fixFrom(err)}` : ""}` });
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const r = await api<{ accounts: number; revoked: number }>("/api/gmail/disconnect", { method: "POST" });
      setBanner({ tone: "success", text: r.accounts ? "Gmail disconnected and access revoked." : "No Gmail account was connected." });
      setLastResult(null);
      await loadStatus();
    } catch (err) {
      setBanner({ tone: "error", text: `Disconnect failed: ${errorMessage(err)}` });
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await api<SyncStats>("/api/gmail/sync", { method: "POST" });
      setLastResult(result);
      reloadAll();
    } catch (err) {
      setSyncError({ message: errorMessage(err), fix: fixFrom(err) });
      await loadStatus();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-5">
      {banner && (
        <div
          role={banner.tone === "error" ? "alert" : "status"}
          className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-2 text-xs ${
            banner.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          <span>{banner.text}</span>
          <button type="button" onClick={() => setBanner(null)} className="font-bold" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <SummaryPanel summary={summary} loading={summaryLoading} error={summaryError} />

      <ConnectionCard
        status={status}
        syncing={syncing}
        busy={busy}
        lastResult={lastResult}
        syncError={syncError}
        onConnect={connect}
        onDisconnect={disconnect}
        onSync={sync}
      />

      <EventsList events={events} loading={eventsLoading} error={eventsError} filters={filters} onFilters={changeFilters} />

      <DemoTools demoCount={status?.demoEvents ?? 0} onChanged={reloadAll} />
    </div>
  );
}
