"use client";

import React, { useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { CLASSIFICATION_LABELS } from "./types";

interface Preview {
  classification: string;
  confidence: number;
  importance: string;
  company?: string;
  role?: string;
  deadline?: string;
  suggestedAction: string;
  explanation: string;
}

/**
 * Demo controls. Nothing here touches real data: the classifier test stores nothing, and demo
 * events are flagged DEMO, never linked to applications or contacts, and hidden by default.
 */
export function DemoTools({ demoCount, onChanged }: { demoCount: number; onChanged: () => void }) {
  const [sender, setSender] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="bg-slate-50 rounded-xl border border-dashed border-slate-300 p-4">
      <summary className="text-xs font-extrabold text-slate-700 cursor-pointer">Test the classifier and demo data (never changes real data)</summary>

      <form
        className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => setPreview(await api<Preview>("/api/gmail/classify", { body: { sender, subject, body } })));
        }}
      >
        <input aria-label="Test sender" placeholder="From (e.g. no-reply@us.greenhouse-mail.io)" value={sender} onChange={(e) => setSender(e.target.value)} className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg" />
        <input aria-label="Test subject" placeholder="Subject" required value={subject} onChange={(e) => setSubject(e.target.value)} className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg" />
        <input aria-label="Test body" placeholder="Body text" value={body} onChange={(e) => setBody(e.target.value)} className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg" />
        <div className="md:col-span-3">
          <button type="submit" disabled={busy} className="px-3 py-1.5 bg-slate-900 text-white text-xs font-bold rounded-lg disabled:opacity-50">
            Classify (preview only)
          </button>
        </div>
      </form>

      {preview && (
        <div className="mt-2 text-xs text-slate-700 bg-white rounded-lg border border-slate-200 p-3" data-testid="classify-preview">
          <p>
            <span className="font-bold">{CLASSIFICATION_LABELS[preview.classification] || preview.classification}</span> · {Math.round(preview.confidence * 100)}% · {preview.importance}
            {preview.company ? ` · ${preview.company}` : ""}
            {preview.role ? ` · ${preview.role}` : ""}
          </p>
          {preview.deadline && <p>Deadline: {preview.deadline}</p>}
          <p className="text-slate-500">{preview.explanation}</p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const r = await api<{ created: number }>("/api/gmail/demo", { method: "POST" });
              setMessage(`Added ${r.created} demo event(s). Choose "Real + demo" in the events filter to see them.`);
              onChanged();
            })
          }
          className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-semibold disabled:opacity-50"
        >
          Load demo events
        </button>
        <button
          type="button"
          disabled={busy || demoCount === 0}
          onClick={() =>
            run(async () => {
              const r = await api<{ deleted: number }>("/api/gmail/demo", { method: "DELETE" });
              setMessage(`Removed ${r.deleted} demo event(s).`);
              onChanged();
            })
          }
          className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-semibold disabled:opacity-50"
        >
          Clear demo data ({demoCount})
        </button>
        {message && (
          <span className="text-slate-600" role="status">
            {message}
          </span>
        )}
      </div>
    </details>
  );
}
