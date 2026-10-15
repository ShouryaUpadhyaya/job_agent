"use client";

import React, { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { Card, Notice, NoticeBanner } from "./ui";
import { FieldSource, WellfoundConfig, WellfoundProfile, WellfoundRules } from "./types";

type TextField = Exclude<keyof WellfoundProfile, "highlights">;

const SECTIONS: { title: string; fields: { key: TextField; label: string; long?: boolean; hint?: string }[] }[] = [
  {
    title: "Identity & contact",
    fields: [
      { key: "name", label: "Full name" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "location", label: "Current location" },
    ],
  },
  {
    title: "Background",
    fields: [
      { key: "currentRole", label: "Current role (used in “I'm …, <role>”)", long: true },
      { key: "company", label: "Current company / organisation" },
      { key: "school", label: "School" },
      { key: "education", label: "Education", long: true },
      { key: "yearsOfExperience", label: "Experience (answers “years of experience”)", long: true },
      { key: "skills", label: "Skills (comma separated)", long: true },
    ],
  },
  {
    title: "Application answers",
    fields: [
      { key: "noticePeriod", label: "Notice period / availability", hint: "e.g. 2 weeks" },
      { key: "currentCTC", label: "Current CTC (LPA, number)" },
      { key: "expectedCTC", label: "Expected CTC (LPA)" },
      { key: "dob", label: "Date of birth" },
      { key: "gender", label: "Gender", hint: "Leave blank to pick “prefer not to say” when offered, otherwise skip" },
      { key: "workAuth", label: "Work authorisation", long: true },
    ],
  },
  {
    title: "Links",
    fields: [
      { key: "github", label: "GitHub" },
      { key: "linkedin", label: "LinkedIn" },
      { key: "portfolio", label: "Portfolio" },
      { key: "x", label: "X" },
    ],
  },
];

const SOURCE_HINT: Record<FieldSource, string> = {
  profile: "",
  "legacy-env": "from the old wellfound .env — save to keep",
  "resume-defaults": "from your resume defaults — save to keep",
  empty: "",
};

export default function ProfilePanel({ onSaved }: { onSaved: () => void }) {
  const [config, setConfig] = useState<WellfoundConfig | null>(null);
  const [profile, setProfile] = useState<WellfoundProfile | null>(null);
  const [highlights, setHighlights] = useState("");
  const [rules, setRules] = useState<WellfoundRules | null>(null);
  const [geminiKey, setGeminiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    void (async () => {
      try {
        const cfg = await api<WellfoundConfig>("/api/wellfound/config");
        setConfig(cfg);
        setProfile(cfg.profile);
        setHighlights(cfg.profile.highlights.join("\n"));
        setRules(cfg.rules);
      } catch (e) {
        setNotice({ type: "error", text: `Could not load the profile: ${errorMessage(e)}` });
      }
    })();
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !rules) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await api<WellfoundConfig & { message: string }>("/api/wellfound/config", {
        method: "PUT",
        body: {
          profile: { ...profile, highlights: highlights.split("\n").map((s) => s.trim()).filter(Boolean) },
          rules,
          geminiKey: geminiKey.trim() || undefined,
        },
      });
      setConfig({ ...res, envWritable: config?.envWritable ?? false });
      setProfile(res.profile);
      setRules(res.rules);
      setGeminiKey("");
      setNotice({ type: "success", text: `${res.message} Runs and the Zen script use these values.` });
      onSaved();
    } catch (err) {
      setNotice({ type: "error", text: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  if (!profile || !rules || !config) {
    return (
      <Card>
        <NoticeBanner notice={notice} onClose={() => setNotice(null)} />
        {!notice && <p className="text-sm text-slate-500">Loading profile…</p>}
      </Card>
    );
  }

  const input = "mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200";

  return (
    <form onSubmit={save} className="space-y-6">
      <Card title="Application profile">
        <p className="text-xs text-slate-500">
          Saved to your candidate profile in the database (the source of truth for every run). Fields marked with a hint are still coming from a fallback.
        </p>
        {SECTIONS.map((section) => (
          <div key={section.title} className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">{section.title}</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {section.fields.map((f) => (
                <label key={f.key} className={`block text-xs font-semibold text-slate-600 ${f.long ? "md:col-span-2" : ""}`}>
                  {f.label}
                  {SOURCE_HINT[config.sources[f.key]] && <span className="ml-2 font-normal text-amber-600">{SOURCE_HINT[config.sources[f.key]]}</span>}
                  {f.long ? (
                    <textarea rows={2} value={profile[f.key]} onChange={(e) => setProfile({ ...profile, [f.key]: e.target.value })} className={input} />
                  ) : (
                    <input value={profile[f.key]} onChange={(e) => setProfile({ ...profile, [f.key]: e.target.value })} className={input} />
                  )}
                  {f.hint && <span className="block mt-1 font-normal text-slate-400">{f.hint}</span>}
                </label>
              ))}
            </div>
          </div>
        ))}
        <label className="block text-xs font-semibold text-slate-600">
          Highlights (one per line, no trailing period — used in cover letters and answers)
          {SOURCE_HINT[config.sources.highlights] && <span className="ml-2 font-normal text-amber-600">{SOURCE_HINT[config.sources.highlights]}</span>}
          <textarea rows={6} value={highlights} onChange={(e) => setHighlights(e.target.value)} className={input} />
        </label>
      </Card>

      <Card title="Rules">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="block text-xs font-semibold text-slate-600">
            Daily cap (live applications per IST day)
            <input type="number" min={1} max={100} value={rules.dailyCap} onChange={(e) => setRules({ ...rules, dailyCap: parseInt(e.target.value, 10) || 1 })} className={input} />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Max run time (minutes)
            <input type="number" min={5} max={240} value={rules.maxRuntimeMinutes} onChange={(e) => setRules({ ...rules, maxRuntimeMinutes: parseInt(e.target.value, 10) || 100 })} className={input} />
          </label>
          <label className="flex items-start gap-2 text-xs text-slate-700 md:pt-5">
            <input type="checkbox" checked={rules.autoTickTerms} onChange={(e) => setRules({ ...rules, autoTickTerms: e.target.checked })} className="mt-0.5" />
            <span>
              Auto-tick consent / terms checkboxes
              <span className="block text-slate-400">When on, you agree to each company&apos;s terms on submit. When off, forms that require it are skipped.</span>
            </span>
          </label>
        </div>
      </Card>

      <Card title="Gemini (optional)">
        <p className="text-xs text-slate-500">
          Status: {config.geminiConfigured ? <strong className="text-emerald-700">configured</strong> : <strong className="text-slate-700">not set — template answers are used</strong>}.
          The key is never shown here or sent into the Wellfound page; the runner calls Gemini from Node.
        </p>
        {config.envWritable ? (
          <label className="block text-xs font-semibold text-slate-600">
            Replace key (leave blank to keep the current one)
            <input type="password" autoComplete="off" value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} className={input} />
          </label>
        ) : (
          <p className="text-xs text-slate-500">The server can&apos;t write .env here (running in Docker). Set GEMINI_KEY in the root .env on the host.</p>
        )}
      </Card>

      <NoticeBanner notice={notice} onClose={() => setNotice(null)} />
      <button type="submit" disabled={saving} className="px-5 py-2.5 text-sm font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50">
        {saving ? "Saving…" : "Save profile & rules"}
      </button>
    </form>
  );
}
