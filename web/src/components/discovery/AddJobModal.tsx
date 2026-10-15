"use client";

import React, { useState } from "react";
import { api, errorMessage } from "@/lib/api";

type Props = {
  onClose: () => void;
  onImported: (message: string) => void;
};

type ImportResult = { job: { title: string }; isNew: boolean; application?: { stage: string } | null };

/** Guesses title/company/location from the first lines of pasted text (all local). */
export function guessFromPastedText(text: string): { title?: string; company?: string; location?: string } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6);
  const out: { title?: string; company?: string; location?: string } = {};
  if (lines[0] && lines[0].length < 120) out.title = lines[0];
  const meta = lines[1];
  if (meta && meta.length < 160) {
    const parts = meta.split(/\s+[·•|]\s+/);
    out.company = parts[0];
    if (parts[1]) out.location = parts[1];
  }
  return out;
}

export default function AddJobModal({ onClose, onImported }: Props) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [track, setTrack] = useState(true);
  const [stage, setStage] = useState("BOOKMARKED");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDescriptionChange = (value: string) => {
    setDescription(value);
    if (!title && !company) {
      const g = guessFromPastedText(value);
      if (g.title) setTitle(g.title);
      if (g.company) setCompany(g.company);
      if (g.location && !location) setLocation(g.location);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setError(null);
      const data = await api<ImportResult>("/api/jobs/import", {
        body: { url, title, company, location, description, trackInPipeline: track, stage: track ? stage : undefined },
      });
      onImported(
        data.application
          ? `✓ "${data.job.title}" added and tracked in the pipeline (${data.application.stage}).`
          : `✓ "${data.job.title}" ${data.isNew ? "added" : "updated"}.`
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const input = "mt-1 w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500";

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="add-job-title">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 id="add-job-title" className="text-base font-extrabold text-slate-900">Add job manually</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-sm font-bold" aria-label="Close">✕</button>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Paste the details from any job page (LinkedIn, Wellfound, Naukri, a careers site…). Job Agent stores the link but never opens it;
          the description is scored locally against your profile.
        </p>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div>
            <label htmlFor="add-url" className="text-xs font-bold text-slate-700">Job URL</label>
            <input id="add-url" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className={input} />
          </div>
          <div>
            <label htmlFor="add-description" className="text-xs font-bold text-slate-700">Job description</label>
            <textarea
              id="add-description"
              rows={6}
              required
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder="Paste the full job text. If it starts with the title and 'Company · Location', those fields fill in."
              className={input}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="add-title" className="text-xs font-bold text-slate-700">Title</label>
              <input id="add-title" required value={title} onChange={(e) => setTitle(e.target.value)} className={input} />
            </div>
            <div>
              <label htmlFor="add-company" className="text-xs font-bold text-slate-700">Company</label>
              <input id="add-company" required value={company} onChange={(e) => setCompany(e.target.value)} className={input} />
            </div>
          </div>
          <div>
            <label htmlFor="add-location" className="text-xs font-bold text-slate-700">Location</label>
            <input id="add-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Bengaluru, Remote" className={input} />
          </div>
          <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl space-y-2">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer">
              <input type="checkbox" checked={track} onChange={(e) => setTrack(e.target.checked)} className="rounded" />
              Track in Application Pipeline
            </label>
            {track && (
              <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Initial stage" className="ml-6 px-2 py-1 text-xs rounded-md border border-slate-300 bg-white">
                <option value="BOOKMARKED">Saved (BOOKMARKED)</option>
                <option value="APPLYING">Preparing (APPLYING)</option>
                <option value="APPLIED">Applied (APPLIED)</option>
              </select>
            )}
          </div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50">
              {saving ? "Saving…" : "Add job"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
