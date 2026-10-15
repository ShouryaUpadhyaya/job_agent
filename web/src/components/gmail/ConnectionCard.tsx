"use client";

import React, { useState } from "react";
import { GmailStatus, SyncStats, formatWhen } from "./types";

interface Props {
  status: GmailStatus | null;
  syncing: boolean;
  busy: boolean;
  lastResult: SyncStats | null;
  syncError: { message: string; fix?: string } | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onSync: () => void;
}

export function SyncStatsLine({ stats }: { stats: SyncStats }) {
  return (
    <span>
      {stats.fetched} matched, {stats.new} new, {stats.skipped} already seen
      {stats.errors ? `, ${stats.errors} failed` : ""}
      {stats.remaining ? `, ${stats.remaining} left for the next sync` : ""}
      {stats.stageChanges ? ` · ${stats.stageChanges} stage change${stats.stageChanges > 1 ? "s" : ""}` : ""}
      {stats.applicationsCreated ? ` · ${stats.applicationsCreated} new application${stats.applicationsCreated > 1 ? "s" : ""}` : ""}
      {stats.contactsCreated ? ` · ${stats.contactsCreated} new contact${stats.contactsCreated > 1 ? "s" : ""}` : ""}
      {stats.jobAlertListings ? ` · ${stats.jobAlertListings} listings from alerts` : ""}
    </span>
  );
}

export function ConnectionCard({ status, syncing, busy, lastResult, syncError, onConnect, onDisconnect, onSync }: Props) {
  const [confirming, setConfirming] = useState(false);

  if (!status) {
    return <div className="bg-white rounded-xl border border-slate-200 p-6 text-xs text-slate-400">Loading Gmail status…</div>;
  }

  const expired = status.accountStatus === "EXPIRED";
  const badge = !status.configured
    ? { text: "Not configured", tone: "bg-slate-100 text-slate-600 border-slate-200" }
    : status.connected
      ? { text: "Connected", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" }
      : expired
        ? { text: "Authorization expired", tone: "bg-rose-50 text-rose-700 border-rose-200" }
        : { text: "Not connected", tone: "bg-slate-100 text-slate-600 border-slate-200" };
  const stats = lastResult || status.lastSync;
  const error = syncError || (status.lastError ? { message: status.lastError.message, fix: status.lastError.fix } : null);

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3" aria-label="Gmail connection">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-extrabold text-slate-900">Gmail</h3>
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${badge.tone}`}>{badge.text}</span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {status.connected || expired
              ? `Account: ${status.email}`
              : "Read-only access. Job emails are classified and used to update your pipeline and networking contacts."}
          </p>
          {status.lastSyncedAt && <p className="text-[11px] text-slate-400 mt-1">Last sync: {formatWhen(status.lastSyncedAt)}</p>}
          {stats && (
            <p className="text-[11px] text-slate-500 mt-0.5" data-testid="sync-stats">
              {lastResult ? "This sync: " : "Last run: "}
              <SyncStatsLine stats={stats} />
            </p>
          )}
        </div>

        {status.configured && (
          <div className="flex flex-wrap items-center gap-2">
            {status.connected && (
              <button
                type="button"
                onClick={onSync}
                disabled={syncing || busy}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg disabled:opacity-50"
              >
                {syncing ? "Syncing…" : "Sync now"}
              </button>
            )}
            <button
              type="button"
              onClick={onConnect}
              disabled={busy}
              className={`px-3 py-2 text-xs font-bold rounded-lg disabled:opacity-50 ${
                status.connected ? "bg-slate-100 hover:bg-slate-200 text-slate-700" : "bg-red-600 hover:bg-red-700 text-white"
              }`}
            >
              {status.connected ? "Reconnect" : expired ? "Reconnect Gmail" : "Connect Gmail"}
            </button>
            {(status.connected || expired) &&
              (confirming ? (
                <span className="flex items-center gap-1 text-xs" role="group" aria-label="Confirm disconnect">
                  <span className="text-slate-600">Disconnect and revoke access?</span>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirming(false);
                      onDisconnect();
                    }}
                    className="px-2 py-1 bg-rose-600 text-white font-bold rounded-md"
                  >
                    Yes, disconnect
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} className="px-2 py-1 bg-slate-100 text-slate-700 rounded-md">
                    Cancel
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirming(true)} disabled={busy} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg">
                  Disconnect
                </button>
              ))}
          </div>
        )}
      </div>

      {!status.configured && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900" role="note">
          <p className="font-bold">Gmail is not set up yet. Missing: {status.missingEnv.join(", ")}.</p>
          <ol className="list-decimal ml-5 mt-2 space-y-1">
            {status.setup.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900" role="alert">
          <p className="font-bold">Last sync failed: {error.message}</p>
          {error.fix && <p className="mt-1">How to fix: {error.fix}</p>}
        </div>
      )}
    </section>
  );
}
