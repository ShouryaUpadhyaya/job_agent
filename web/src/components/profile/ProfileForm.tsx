"use client";

import React, { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { ANSWER_FIELDS, CandidateProfile, Education, ExperienceEntry, RescoreOutcome, rescoreText } from "./types";

const input =
  "w-full text-sm p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 text-slate-800";
const labelCls = "block text-xs font-semibold text-slate-600 mb-1";
const sectionCls = "bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-400 mt-1">{hint}</span>}
    </label>
  );
}

function ChipList({
  items,
  onChange,
  placeholder,
  addLabel,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  addLabel: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const values = draft.split(",").map((s) => s.trim()).filter(Boolean);
    const next = [...items];
    for (const v of values) if (!next.some((x) => x.toLowerCase() === v.toLowerCase())) next.push(v);
    onChange(next);
    setDraft("");
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {items.length === 0 && <span className="text-xs text-slate-400">None yet.</span>}
        {items.map((item) => (
          <span key={item} className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-md border border-indigo-100">
            {item}
            <button type="button" aria-label={`Remove ${item}`} onClick={() => onChange(items.filter((x) => x !== item))} className="text-indigo-400 hover:text-indigo-700 font-black">
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className={input}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" onClick={add} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs whitespace-nowrap">
          {addLabel}
        </button>
      </div>
    </div>
  );
}

type ExperienceDraft = { kind: "work" | "project"; role: string; company: string; dates: string; bullets: string };

function toDrafts(raw: unknown): ExperienceDraft[] {
  if (!Array.isArray(raw)) return [];
  return (raw as ExperienceEntry[])
    .filter((e) => e && typeof e === "object")
    .map((e) => ({
      kind: e.kind === "project" ? "project" : "work",
      role: e.role || "",
      company: e.company || "",
      dates: e.dates || "",
      bullets: Array.isArray(e.bullets) ? e.bullets.join("\n") : "",
    }));
}

function fromDrafts(drafts: ExperienceDraft[]): ExperienceEntry[] {
  return drafts
    .map((d) => ({
      kind: d.kind,
      role: d.role.trim() || undefined,
      company: d.company.trim() || undefined,
      dates: d.dates.trim() || undefined,
      bullets: d.bullets.split("\n").map((b) => b.trim()).filter(Boolean),
    }))
    .filter((e) => e.role || e.company || e.bullets.length);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

export default function ProfileForm({
  profile,
  onSaved,
}: {
  profile: CandidateProfile;
  onSaved: (message: string) => void;
}) {
  const answers = (profile.applicationAnswers && typeof profile.applicationAnswers === "object" ? profile.applicationAnswers : {}) as Record<string, unknown>;
  const edu: Education = profile.education && typeof profile.education === "object" ? profile.education : {};
  // Experience that isn't a list (legacy objects) is preserved untouched unless the user edits it.
  const experienceIsList = profile.experience == null || Array.isArray(profile.experience);

  const [basics, setBasics] = useState({
    name: profile.name || "",
    email: profile.email || "",
    phone: profile.phone || "",
    location: profile.location || "",
    school: profile.school || "",
    targetRole: profile.targetRole || "",
    targetGradYear: profile.targetGradYear ? String(profile.targetGradYear) : "",
    githubUrl: profile.githubUrl || "",
    linkedinUrl: profile.linkedinUrl || "",
    portfolioUrl: profile.portfolioUrl || "",
    xUrl: profile.xUrl || "",
  });
  const [skills, setSkills] = useState<string[]>(profile.skills || []);
  const [locations, setLocations] = useState<string[]>(profile.preferredLocations || []);
  const [remoteOk, setRemoteOk] = useState(profile.remoteOk ?? true);
  const [education, setEducation] = useState({
    institution: edu.institution || "",
    degree: edu.degree || "",
    startYear: edu.startYear ? String(edu.startYear) : "",
    graduationYear: edu.graduationYear ? String(edu.graduationYear) : "",
    gpa: edu.gpa || "",
  });
  const [experience, setExperience] = useState<ExperienceDraft[]>(toDrafts(profile.experience));
  const [experienceTouched, setExperienceTouched] = useState(false);
  const [answerValues, setAnswerValues] = useState<Record<string, string>>(
    Object.fromEntries(ANSWER_FIELDS.map((f) => [f.key, str(answers[f.key])]))
  );
  const [highlights, setHighlights] = useState(Array.isArray(answers.highlights) ? (answers.highlights as string[]).join("\n") : str(answers.highlights));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setBasic = (key: keyof typeof basics) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setBasics((b) => ({ ...b, [key]: e.target.value }));
  const setEdu = (key: keyof typeof education) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setEducation((v) => ({ ...v, [key]: e.target.value }));
  const updateExperience = (i: number, patch: Partial<ExperienceDraft>) => {
    setExperienceTouched(true);
    setExperience((list) => list.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const year = (s: string) => (s.trim() ? Number(s) : undefined);
    if (basics.targetGradYear && !Number.isInteger(Number(basics.targetGradYear))) {
      setError("Graduation year must be a number like 2028.");
      return;
    }
    const answerPatch: Record<string, unknown> = {};
    for (const f of ANSWER_FIELDS) answerPatch[f.key] = answerValues[f.key].trim() || null;
    const hl = highlights.split("\n").map((s) => s.trim()).filter(Boolean);
    answerPatch.highlights = hl.length ? hl : null;

    const body: Record<string, unknown> = {
      id: profile.id,
      ...basics,
      targetGradYear: basics.targetGradYear ? Number(basics.targetGradYear) : null,
      skills,
      preferredLocations: locations,
      remoteOk,
      education: {
        ...edu,
        institution: education.institution.trim() || undefined,
        degree: education.degree.trim() || undefined,
        startYear: year(education.startYear),
        graduationYear: year(education.graduationYear),
        gpa: education.gpa.trim() || undefined,
      },
      applicationAnswers: answerPatch,
    };
    if (experienceIsList || experienceTouched) body.experience = fromDrafts(experience);

    try {
      setSaving(true);
      setError(null);
      const res = await api<{ rescore?: RescoreOutcome }>("/api/profiles", { body });
      onSaved(`Profile saved.${rescoreText(res.rescore)}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-5" aria-label="Candidate profile">
      <section className={sectionCls}>
        <h3 className="font-bold text-slate-900">About you</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Name">
            <input className={input} value={basics.name} onChange={setBasic("name")} required />
          </Field>
          <Field label="Email">
            <input className={input} type="email" value={basics.email} onChange={setBasic("email")} />
          </Field>
          <Field label="Phone">
            <input className={input} value={basics.phone} onChange={setBasic("phone")} />
          </Field>
          <Field label="Current location">
            <input className={input} value={basics.location} onChange={setBasic("location")} />
          </Field>
          <Field label="School">
            <input className={input} value={basics.school} onChange={setBasic("school")} />
          </Field>
          <Field label="Graduation year">
            <input className={input} inputMode="numeric" value={basics.targetGradYear} onChange={setBasic("targetGradYear")} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Target role(s)" hint="Comma-separated, e.g. Backend Engineer Intern, Full-Stack Intern">
              <input className={input} value={basics.targetRole} onChange={setBasic("targetRole")} />
            </Field>
          </div>
        </div>
      </section>

      <section className={sectionCls}>
        <h3 className="font-bold text-slate-900">Links</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="GitHub">
            <input className={input} value={basics.githubUrl} onChange={setBasic("githubUrl")} placeholder="https://github.com/…" />
          </Field>
          <Field label="LinkedIn">
            <input className={input} value={basics.linkedinUrl} onChange={setBasic("linkedinUrl")} placeholder="https://linkedin.com/in/…" />
          </Field>
          <Field label="Portfolio">
            <input className={input} value={basics.portfolioUrl} onChange={setBasic("portfolioUrl")} />
          </Field>
          <Field label="X">
            <input className={input} value={basics.xUrl} onChange={setBasic("xUrl")} placeholder="https://x.com/…" />
          </Field>
        </div>
      </section>

      <section className={sectionCls}>
        <h3 className="font-bold text-slate-900">Job preferences</h3>
        <div>
          <span className={labelCls}>Preferred locations</span>
          <ChipList items={locations} onChange={setLocations} placeholder="Add a city or country…" addLabel="+ Add location" />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={remoteOk} onChange={(e) => setRemoteOk(e.target.checked)} />
          Open to remote roles
        </label>
        <div>
          <span className={labelCls}>Skills ({skills.length})</span>
          <ChipList items={skills} onChange={setSkills} placeholder="Add skill (e.g. Docker, Rust, Redis)…" addLabel="+ Add" />
          <p className="text-[11px] text-slate-400 mt-1">Used for matching only when you have no resumes; each resume has its own skills below.</p>
        </div>
      </section>

      <section className={sectionCls}>
        <h3 className="font-bold text-slate-900">Education</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Institution">
            <input className={input} value={education.institution} onChange={setEdu("institution")} />
          </Field>
          <Field label="Degree">
            <input className={input} value={education.degree} onChange={setEdu("degree")} />
          </Field>
          <Field label="Start year">
            <input className={input} inputMode="numeric" value={education.startYear} onChange={setEdu("startYear")} />
          </Field>
          <Field label="End / graduation year">
            <input className={input} inputMode="numeric" value={education.graduationYear} onChange={setEdu("graduationYear")} />
          </Field>
          <Field label="GPA">
            <input className={input} value={education.gpa} onChange={setEdu("gpa")} />
          </Field>
        </div>
      </section>

      <section className={sectionCls}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-slate-900">Experience & projects</h3>
          <button
            type="button"
            onClick={() => {
              setExperienceTouched(true);
              setExperience((l) => [...l, { kind: "work", role: "", company: "", dates: "", bullets: "" }]);
            }}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs"
          >
            + Add entry
          </button>
        </div>
        {!experienceIsList && !experienceTouched && (
          <p className="text-xs text-amber-700">Your saved experience is in an older format; it is kept as-is until you add entries here.</p>
        )}
        {experience.length === 0 && <p className="text-xs text-slate-400">No entries. Uploading a resume fills these in when empty.</p>}
        {experience.map((exp, i) => (
          <div key={i} className="border border-slate-200 rounded-xl p-3 space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <select className={input} aria-label="Entry type" value={exp.kind} onChange={(e) => updateExperience(i, { kind: e.target.value as "work" | "project" })}>
                <option value="work">Work</option>
                <option value="project">Project</option>
              </select>
              <input className={input} aria-label="Role or project name" placeholder={exp.kind === "project" ? "Project name" : "Role"} value={exp.role} onChange={(e) => updateExperience(i, { role: e.target.value })} />
              <input className={input} aria-label="Company" placeholder="Company" value={exp.company} onChange={(e) => updateExperience(i, { company: e.target.value })} />
              <input className={input} aria-label="Dates" placeholder="Apr 2025 – Oct 2025" value={exp.dates} onChange={(e) => updateExperience(i, { dates: e.target.value })} />
            </div>
            <textarea
              className={`${input} h-24 font-mono text-xs`}
              aria-label="Bullets"
              placeholder="One bullet per line"
              value={exp.bullets}
              onChange={(e) => updateExperience(i, { bullets: e.target.value })}
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setExperienceTouched(true);
                  setExperience((l) => l.filter((_, idx) => idx !== i));
                }}
                className="text-xs font-semibold text-rose-600 hover:text-rose-800"
              >
                Remove entry
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className={sectionCls}>
        <div>
          <h3 className="font-bold text-slate-900">Application answers</h3>
          <p className="text-xs text-slate-500 mt-0.5">Reused when filling application forms (including Wellfound auto-apply). Leave blank to skip a question.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {ANSWER_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.key === "gender" ? "Blank = prefer not to say" : undefined}>
              {f.options ? (
                <select
                  className={input}
                  value={answerValues[f.key]}
                  onChange={(e) => setAnswerValues((v) => ({ ...v, [f.key]: e.target.value }))}
                >
                  {f.options.map((o) => (
                    <option key={o} value={o}>
                      {o || (f.key === "gender" ? "Prefer not to say" : "—")}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={input}
                  value={answerValues[f.key]}
                  placeholder={f.placeholder}
                  onChange={(e) => setAnswerValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              )}
            </Field>
          ))}
          <div className="md:col-span-2">
            <Field label="Highlights" hint="One per line; used for short 'why you' answers.">
              <textarea className={`${input} h-20`} value={highlights} onChange={(e) => setHighlights(e.target.value)} />
            </Field>
          </div>
        </div>
      </section>

      {error && (
        <div role="alert" className="p-3 rounded-xl text-sm bg-rose-50 text-rose-800 border border-rose-200">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={saving} className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm shadow-md disabled:opacity-60">
          {saving ? "Saving…" : "Save Profile Changes"}
        </button>
      </div>
    </form>
  );
}
