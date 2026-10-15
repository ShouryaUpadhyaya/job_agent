"use client";

import React, { useState } from "react";
import { ApiError, api, errorMessage } from "@/lib/api";
import { CONTACT_STATUSES, Contact, PERSONAS, PERSONA_LABELS, STATUS_LABELS } from "./types";
import { Modal } from "./ui";

type Props = {
  /** Edit this contact; omit to add a new one. */
  contact?: Contact | null;
  /** Prefill for a new contact (e.g. from a Pipeline card). */
  defaults?: { company?: string; targetJobId?: string | null; name?: string; role?: string };
  /** Jobs to offer in the "linked job" picker. */
  jobOptions?: { id: string; title: string; company: string }[];
  onSaved: (contact: Contact) => void;
  onClose: () => void;
  /** Called when the user wants to open an existing duplicate instead. */
  onOpenExisting?: (contact: Contact) => void;
};

type Form = {
  name: string;
  company: string;
  role: string;
  headline: string;
  linkedinUrl: string;
  xUrl: string;
  githubUrl: string;
  email: string;
  school: string;
  persona: string;
  vitAlumni: boolean;
  notes: string;
  targetJobId: string;
  status: string;
};

type HeadlineGuess = { role: string | null; company: string | null; persona: string; school: string | null; vitAlumni: boolean };

type Duplicate = { message: string; duplicate: Contact; canForce: boolean };

function payloadOf(form: Form): Record<string, unknown> {
  return {
    name: form.name,
    company: form.company,
    role: form.role,
    headline: form.headline || null,
    linkedinUrl: form.linkedinUrl || null,
    xUrl: form.xUrl || null,
    githubUrl: form.githubUrl || null,
    email: form.email || null,
    school: form.school || null,
    ...(form.persona ? { persona: form.persona } : {}),
    vitAlumni: form.vitAlumni,
    notes: form.notes || null,
    targetJobId: form.targetJobId || null,
    status: form.status,
  };
}

const fromContact = (c?: Contact | null, d?: Props["defaults"]): Form => ({
  name: c?.name ?? d?.name ?? "",
  company: c?.company ?? d?.company ?? "",
  role: c?.role ?? d?.role ?? "",
  headline: c?.headline ?? "",
  linkedinUrl: c?.linkedinUrl ?? "",
  xUrl: c?.xUrl ?? "",
  githubUrl: c?.githubUrl ?? "",
  email: c?.email ?? "",
  school: c?.school ?? "",
  persona: c?.persona ?? "",
  vitAlumni: c?.vitAlumni ?? false,
  notes: c?.notes ?? "",
  targetJobId: c?.targetJobId ?? d?.targetJobId ?? "",
  status: c?.status ?? "RESEARCHED",
});

/** Client-side shape checks mirroring the server (the server re-validates). */
export function validateContactForm(f: Pick<Form, "name" | "company" | "linkedinUrl" | "xUrl" | "githubUrl" | "email">): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.name.trim()) e.name = "Name is required";
  if (!f.company.trim()) e.company = "Company is required";
  if (f.linkedinUrl.trim() && !/^(https?:\/\/)?([a-z]{2,3}\.)?linkedin\.com\/in\/[^/?#\s]+\/?(\?.*)?$/i.test(f.linkedinUrl.trim()))
    e.linkedinUrl = "Use a profile URL like https://www.linkedin.com/in/name (not a search link)";
  if (f.xUrl.trim() && !/^((https?:\/\/)?(www\.|mobile\.)?(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/?(\?.*)?|@[A-Za-z0-9_]{1,15})$/i.test(f.xUrl.trim()))
    e.xUrl = "Use https://x.com/handle or @handle";
  else if (/\/(home|search|i|intent|share|explore|hashtag)\/?(\?|$)/i.test(f.xUrl.trim())) e.xUrl = "Use a profile URL, not an X page";
  if (f.githubUrl.trim() && !/^(https?:\/\/)?(www\.)?github\.com\/[A-Za-z0-9-]{1,39}\/?$/i.test(f.githubUrl.trim()))
    e.githubUrl = "Use https://github.com/user";
  if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(f.email.trim())) e.email = "Email looks invalid";
  return e;
}

export default function QuickAddContact({ contact, defaults, jobOptions, onSaved, onClose, onOpenExisting }: Props) {
  const editing = Boolean(contact);
  const [form, setForm] = useState<Form>(() => fromContact(contact, defaults));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const [saving, setSaving] = useState(false);
  const [guess, setGuess] = useState<HeadlineGuess | null>(null);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setTouched((t) => ({ ...t, [key]: true }));
  };

  const parseHeadline = async () => {
    const text = form.headline.trim();
    if (!text) return;
    try {
      const g = await api<HeadlineGuess>("/api/networking/parse-headline", { body: { text } });
      setGuess(g);
      // Only fill fields the user hasn't typed into.
      setForm((f) => ({
        ...f,
        role: !touched.role && !f.role && g.role ? g.role : f.role,
        company: !touched.company && !f.company && g.company ? g.company : f.company,
        persona: !touched.persona && g.persona ? g.persona : f.persona,
        school: !touched.school && !f.school && g.school ? g.school : f.school,
        vitAlumni: !touched.vitAlumni && g.vitAlumni ? true : f.vitAlumni,
      }));
    } catch {
      /* guesses are optional */
    }
  };

  const payload = (extra: Record<string, unknown> = {}) => ({ ...payloadOf(form), ...extra });

  /** For edits, send only what changed (so e.g. an email's Gmail/GitHub origin is kept). */
  const changedFields = () => {
    const original = payloadOf(fromContact(contact));
    const current = payload();
    return Object.fromEntries(Object.entries(current).filter(([k, v]) => (original as Record<string, unknown>)[k] !== v));
  };

  const handleError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 409) {
      const body = err.body as { duplicate?: Contact; canForce?: boolean } | undefined;
      if (body?.duplicate) {
        setDuplicate({ message: err.message, duplicate: body.duplicate, canForce: Boolean(body.canForce) });
        return;
      }
    }
    if (err instanceof ApiError && err.status === 400) {
      const fe = (err.body as { fieldErrors?: Record<string, string> } | undefined)?.fieldErrors;
      if (fe) setErrors(fe);
    }
    setServerError(errorMessage(err));
  };

  const submit = async (e?: React.FormEvent, extra: Record<string, unknown> = {}) => {
    e?.preventDefault();
    const v = validateContactForm(form);
    setErrors(v);
    setServerError(null);
    if (Object.keys(v).length) return;
    try {
      setSaving(true);
      const saved = editing
        ? await api<Contact>(`/api/networking/contacts/${contact!.id}`, { method: "PATCH", body: changedFields() })
        : await api<Contact>("/api/networking/contacts", { body: payload(extra) });
      onSaved(saved);
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  /** Fill the existing contact's blank fields with what was typed here. */
  const updateExisting = async () => {
    if (!duplicate) return;
    const existing = duplicate.duplicate;
    const body: Record<string, unknown> = {};
    const p = payload();
    for (const [k, v] of Object.entries(p)) {
      if (k === "status" || k === "vitAlumni") continue;
      const current = (existing as unknown as Record<string, unknown>)[k];
      if (v && (current === null || current === undefined || current === "")) body[k] = v;
    }
    if (form.vitAlumni && !existing.vitAlumni) body.vitAlumni = true;
    try {
      setSaving(true);
      const saved = await api<Contact>(`/api/networking/contacts/${existing.id}`, { method: "PATCH", body });
      onSaved(saved);
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const input = (key: keyof Form, label: string, placeholder = "", type = "text") => (
    <label className="block">
      <span className="text-xs font-semibold text-slate-700">{label}</span>
      <input
        type={type}
        value={form[key] as string}
        placeholder={placeholder}
        onChange={(e) => set(key, e.target.value as Form[typeof key])}
        aria-invalid={Boolean(errors[key])}
        className={`mt-1 w-full px-3 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 ${errors[key] ? "border-rose-400" : "border-slate-300"}`}
      />
      {errors[key] && <span className="text-[11px] text-rose-600">{errors[key]}</span>}
    </label>
  );

  return (
    <Modal title={editing ? `Edit ${contact!.name}` : "Add a real contact"} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-3">
        {!editing && (
          <p className="text-xs text-slate-500">
            Paste what you see on their LinkedIn or GitHub profile. Nothing is fetched from LinkedIn; the headline is only used to guess the role, persona and
            school, which you can change.
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {input("name", "Name *", "Priya Sharma")}
          {input("company", "Company *", "Razorpay")}
          <label className="block md:col-span-2">
            <span className="text-xs font-semibold text-slate-700">Headline</span>
            <input
              value={form.headline}
              onChange={(e) => set("headline", e.target.value)}
              onBlur={parseHeadline}
              placeholder="SDE-2 @ Razorpay | VIT Vellore '21"
              className="mt-1 w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {guess && (
              <span className="text-[11px] text-slate-500">
                Guessed: {PERSONA_LABELS[guess.persona]}
                {guess.school ? `, ${guess.school}` : ""}
                {guess.company ? `, at ${guess.company}` : ""}. Edit anything that is wrong.
              </span>
            )}
          </label>
          {input("role", "Role", "Software Engineer")}
          <label className="block">
            <span className="text-xs font-semibold text-slate-700">Persona</span>
            <select
              value={form.persona}
              onChange={(e) => set("persona", e.target.value)}
              className="mt-1 w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white"
            >
              <option value="">Guess from role/headline</option>
              {PERSONAS.map((p) => (
                <option key={p} value={p}>
                  {PERSONA_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          {input("linkedinUrl", "LinkedIn profile URL", "https://www.linkedin.com/in/…")}
          {input("xUrl", "X profile", "https://x.com/handle")}
          {input("githubUrl", "GitHub", "https://github.com/user")}
          {input("email", "Email (only one they gave you or published)", "name@company.com", "email")}
          {input("school", "School", "VIT Vellore")}
          <label className="flex items-center gap-2 mt-6 text-xs font-semibold text-slate-700">
            <input type="checkbox" checked={form.vitAlumni} onChange={(e) => set("vitAlumni", e.target.checked)} />
            VIT alumni
          </label>
          {jobOptions && jobOptions.length > 0 && (
            <label className="block">
              <span className="text-xs font-semibold text-slate-700">Linked job</span>
              <select value={form.targetJobId} onChange={(e) => set("targetJobId", e.target.value)} className="mt-1 w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white">
                <option value="">None</option>
                {jobOptions.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title} ({j.company})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className="text-xs font-semibold text-slate-700">Status</span>
            <select value={form.status} onChange={(e) => set("status", e.target.value)} className="mt-1 w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white">
              {CONTACT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="block md:col-span-2">
            <span className="text-xs font-semibold text-slate-700">Notes</span>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className="mt-1 w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg" />
          </label>
        </div>

        {duplicate && (
          <div role="alert" className="p-3 rounded-lg border border-amber-300 bg-amber-50 text-xs text-amber-900 space-y-2">
            <p className="font-semibold">{duplicate.message}</p>
            <div className="flex flex-wrap gap-2">
              {onOpenExisting && (
                <button type="button" onClick={() => onOpenExisting(duplicate.duplicate)} className="px-2 py-1 rounded-md bg-white border border-amber-300 font-semibold">
                  Open existing
                </button>
              )}
              <button type="button" disabled={saving} onClick={updateExisting} className="px-2 py-1 rounded-md bg-amber-600 text-white font-semibold">
                Add these details to the existing contact
              </button>
              {duplicate.canForce && (
                <button type="button" disabled={saving} onClick={() => submit(undefined, { allowDuplicate: true })} className="px-2 py-1 rounded-md bg-white border border-amber-300 font-semibold">
                  It&apos;s a different person: save anyway
                </button>
              )}
            </div>
          </div>
        )}
        {serverError && !duplicate && <p className="text-xs text-rose-600">{serverError}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="px-4 py-1.5 text-xs font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {saving ? "Saving…" : editing ? "Save changes" : "Add contact"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
