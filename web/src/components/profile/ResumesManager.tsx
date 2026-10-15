"use client";

import React, { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { RescoreOutcome, RescoreStatus, Resume, rescoreText } from "./types";

const input =
  "w-full text-sm p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800";

const CATEGORIES = ["", "general", "backend", "fullstack", "frontend", "mobile", "devops", "data", "ml"];

type ListResponse = { resumes: Resume[]; rescore: RescoreStatus };
type CreateResponse = { resume: Resume; filledProfileFields: string[]; rescore: RescoreOutcome };

function SkillEditor({ skills, onChange }: { skills: string[]; onChange: (s: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !skills.some((s) => s.toLowerCase() === v.toLowerCase())) onChange([...skills, v]);
    setDraft("");
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {skills.map((s) => (
          <span key={s} className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-md border border-indigo-100">
            {s}
            <button type="button" aria-label={`Remove ${s}`} onClick={() => onChange(skills.filter((x) => x !== s))} className="text-indigo-400 hover:text-indigo-700 font-black">
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className={input}
          value={draft}
          placeholder="Add skill…"
          aria-label="Add resume skill"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" onClick={add} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs">
          Add
        </button>
      </div>
    </div>
  );
}

function ResumeEditor({ resume, onDone, onCancel }: { resume: Resume; onDone: (msg: string) => void; onCancel: () => void }) {
  const [label, setLabel] = useState(resume.label);
  const [category, setCategory] = useState(resume.targetCategory || "");
  const [skills, setSkills] = useState(resume.skills);
  const [content, setContent] = useState(resume.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (reextract = false) => {
    try {
      setSaving(true);
      setError(null);
      const body: Record<string, unknown> = { label, targetCategory: category || null };
      if (content !== resume.content) body.content = content;
      if (reextract) body.reextractSkills = true;
      else body.skills = skills;
      const res = await api<{ resume: Resume; rescore: RescoreOutcome | null }>(`/api/resumes/${resume.id}`, { method: "PATCH", body });
      onDone(`Saved "${res.resume.label}".${rescoreText(res.rescore)}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 pt-3 border-t border-slate-100">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs font-semibold text-slate-600 mb-1">Label</span>
          <input className={input} value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-slate-600 mb-1">Target category</span>
          <select className={input} value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c || "—"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <span className="block text-xs font-semibold text-slate-600 mb-1">Skills used for matching</span>
        <SkillEditor skills={skills} onChange={setSkills} />
      </div>
      <label className="block">
        <span className="block text-xs font-semibold text-slate-600 mb-1">Resume text</span>
        <textarea className={`${input} h-40 font-mono text-xs`} value={content} onChange={(e) => setContent(e.target.value)} />
      </label>
      {error && (
        <p role="alert" className="text-xs text-rose-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">
          Cancel
        </button>
        <button type="button" disabled={saving} onClick={() => save(true)} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-60">
          Save & re-detect skills from text
        </button>
        <button type="button" disabled={saving} onClick={() => save(false)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60">
          {saving ? "Saving…" : "Save resume"}
        </button>
      </div>
    </div>
  );
}

function AddResume({ onCreated }: { onCreated: (msg: string) => void }) {
  const [mode, setMode] = useState<"pdf" | "text">("pdf");
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setBusy(true);
      setError(null);
      let res: CreateResponse;
      if (mode === "pdf") {
        if (!file) throw new Error("Choose a PDF first.");
        const form = new FormData();
        form.append("resume", file);
        if (label.trim()) form.append("label", label.trim());
        if (category) form.append("targetCategory", category);
        res = await api<CreateResponse>("/api/resumes", { body: form });
      } else {
        if (!text.trim()) throw new Error("Paste your resume text first.");
        res = await api<CreateResponse>("/api/resumes", { body: { content: text, label: label.trim() || undefined, targetCategory: category || undefined } });
      }
      const filled = res.filledProfileFields?.length ? ` Filled empty profile fields: ${res.filledProfileFields.join(", ")}.` : "";
      onCreated(`Added "${res.resume.label}" with ${res.resume.skills.length} skills.${filled}${rescoreText(res.rescore)}`);
      setLabel("");
      setCategory("");
      setText("");
      setFile(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="border border-dashed border-slate-300 rounded-xl p-4 space-y-3 bg-slate-50/50" aria-label="Add resume">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-slate-800">Add a resume</h4>
        <div className="flex gap-1 text-xs">
          <button type="button" onClick={() => setMode("pdf")} className={`px-2.5 py-1 rounded-md font-semibold ${mode === "pdf" ? "bg-indigo-600 text-white" : "bg-white border border-slate-200 text-slate-600"}`}>
            Upload PDF
          </button>
          <button type="button" onClick={() => setMode("text")} className={`px-2.5 py-1 rounded-md font-semibold ${mode === "text" ? "bg-indigo-600 text-white" : "bg-white border border-slate-200 text-slate-600"}`}>
            Paste text
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <input className={input} aria-label="New resume label" placeholder="Label, e.g. Backend" value={label} onChange={(e) => setLabel(e.target.value)} />
        <select className={input} aria-label="New resume category" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c || "Target category (optional)"}
            </option>
          ))}
        </select>
      </div>
      {mode === "pdf" ? (
        <input
          type="file"
          accept=".pdf,application/pdf"
          aria-label="Resume PDF"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="block text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-indigo-700 file:font-semibold"
        />
      ) : (
        <textarea className={`${input} h-32 font-mono text-xs`} aria-label="Resume text" placeholder="Paste the full text of your resume…" value={text} onChange={(e) => setText(e.target.value)} />
      )}
      {error && (
        <p role="alert" className="text-xs text-rose-700">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <button type="submit" disabled={busy} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg disabled:opacity-60">
          {busy ? "Parsing & rescoring…" : "Add resume"}
        </button>
      </div>
    </form>
  );
}

export default function ResumesManager({ onChanged }: { onChanged?: () => void }) {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [rescore, setRescore] = useState<RescoreStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<ListResponse>("/api/resumes")
      .then((d) => {
        if (cancelled) return;
        setResumes(d.resumes || []);
        setRescore(d.rescore || null);
        setError(null);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // While a background rescore runs, refresh until it finishes so "best for N" counts settle.
  useEffect(() => {
    if (!rescore?.running) return;
    const t = setTimeout(() => setReloadKey((k) => k + 1), 3000);
    return () => clearTimeout(t);
  }, [rescore]);

  const changed = useCallback(
    (msg: string) => {
      setMessage(msg);
      setEditing(null);
      setConfirmDelete(null);
      setReloadKey((k) => k + 1);
      onChanged?.();
    },
    [onChanged]
  );

  const makeDefault = async (r: Resume) => {
    try {
      await api(`/api/resumes/${r.id}/default`, { method: "POST" });
      changed(`"${r.label}" is now your default resume.`);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const remove = async (r: Resume) => {
    try {
      const res = await api<{ rescore: RescoreOutcome }>(`/api/resumes/${r.id}`, { method: "DELETE" });
      changed(`Deleted "${r.label}".${rescoreText(res.rescore)}`);
    } catch (err) {
      setConfirmDelete(null);
      setError(errorMessage(err));
    }
  };

  return (
    <section className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4" aria-label="Resumes">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-bold text-slate-900">Resumes</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Every job is scored against each resume and tagged with the best one. The default resume is used when writing cover letters and answers unless a job matches another one better.
          </p>
        </div>
        {rescore?.running && <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 whitespace-nowrap">Rescoring…</span>}
      </div>

      {message && <div className="p-3 rounded-xl text-sm bg-emerald-50 text-emerald-800 border border-emerald-200">{message}</div>}
      {error && (
        <div role="alert" className="p-3 rounded-xl text-sm bg-rose-50 text-rose-800 border border-rose-200">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading resumes…</p>
      ) : resumes.length === 0 ? (
        <p className="text-sm text-slate-500">No resumes yet. Add one below — jobs are scored against your profile skills until you do.</p>
      ) : (
        <ul className="space-y-3">
          {resumes.map((r) => (
            <li key={r.id} className="border border-slate-200 rounded-xl p-4" data-testid="resume-item">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-slate-900">{r.label}</span>
                    {r.isDefault && <span className="text-[10px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-800 rounded px-1.5 py-0.5">Default</span>}
                    {r.targetCategory && <span className="text-[10px] font-semibold uppercase tracking-wide bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">{r.targetCategory}</span>}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Best match for {r.bestForCount} active job{r.bestForCount === 1 ? "" : "s"}
                    {r.fileName ? ` · ${r.fileName}` : ""} · {r.skills.length} skills
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!r.isDefault && (
                    <button type="button" onClick={() => makeDefault(r)} className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">
                      Set default
                    </button>
                  )}
                  <button type="button" onClick={() => setEditing(editing === r.id ? null : r.id)} className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">
                    {editing === r.id ? "Close" : "Edit"}
                  </button>
                  {confirmDelete === r.id ? (
                    <span className="flex items-center gap-1.5 text-xs">
                      <span className="text-rose-700 font-semibold">Delete?</span>
                      <button type="button" onClick={() => remove(r)} className="px-2 py-1 font-bold rounded-lg bg-rose-600 hover:bg-rose-700 text-white">
                        Yes, delete
                      </button>
                      <button type="button" onClick={() => setConfirmDelete(null)} className="px-2 py-1 font-semibold rounded-lg bg-slate-100 text-slate-700">
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setConfirmDelete(r.id)} className="px-2.5 py-1 text-xs font-semibold rounded-lg text-rose-600 hover:bg-rose-50">
                      Delete
                    </button>
                  )}
                </div>
              </div>
              {editing !== r.id && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {r.skills.map((s) => (
                    <span key={s} className="px-2 py-0.5 text-[11px] font-medium bg-indigo-50 text-indigo-700 rounded border border-indigo-100">
                      {s}
                    </span>
                  ))}
                </div>
              )}
              {editing === r.id && <ResumeEditor resume={r} onDone={changed} onCancel={() => setEditing(null)} />}
            </li>
          ))}
        </ul>
      )}

      <AddResume onCreated={changed} />
    </section>
  );
}
