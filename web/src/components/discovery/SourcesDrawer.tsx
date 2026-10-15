"use client";

import React, { useEffect } from "react";
import SourcesManager from "../SourcesManager";

/** Right-hand drawer hosting the job-sources manager (formerly its own "Job Sources" tab). */
export default function SourcesDrawer({ onClose, onSyncFinished }: { onClose: () => void; onSyncFinished: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="sources-drawer-title">
      <button type="button" aria-label="Close sources" className="absolute inset-0 bg-slate-900/40 cursor-default" onClick={onClose} />
      <div className="relative h-full w-full max-w-4xl bg-gray-50 shadow-2xl overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-3 bg-white border-b border-slate-200">
          <h2 id="sources-drawer-title" className="text-base font-bold text-slate-900">
            Manage job sources
          </h2>
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">
            Close
          </button>
        </div>
        <div className="p-6">
          <SourcesManager onSyncFinished={onSyncFinished} />
        </div>
      </div>
    </div>
  );
}
