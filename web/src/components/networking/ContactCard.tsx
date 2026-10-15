"use client";

import React, { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { CONTACT_STATUSES, Contact, MESSAGE_LABELS, MessageType, NetworkingMessage, STATUS_LABELS, canonicalType } from "./types";
import { AlumniBadge, Badge, ContactLinks, CopyButton, PersonaBadge, PriorityPill, SourceBadge, StatusBadge, formatDate } from "./ui";

type Props = {
  contact: Contact;
  onChanged: () => void;
  onEdit: (contact: Contact) => void;
  /** Open the draft modal: a new draft of `type`, or an existing message. */
  onDraft: (contact: Contact, type: MessageType, existing?: NetworkingMessage) => void;
};

export default function ContactCard({ contact, onChanged, onEdit, onDraft }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      setBusy(true);
      setError(null);
      await fn();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const transition = (newStage: string) => run(() => api(`/api/networking/contacts/${contact.id}/transition`, { body: { newStage } }));
  const markSent = (m: NetworkingMessage) => run(() => api(`/api/networking/messages/${m.id}/mark-sent`, { method: "POST" }));
  const remove = () => run(() => api(`/api/networking/contacts/${contact.id}`, { method: "DELETE" }));

  const drafts = contact.messages.filter((m) => m.status !== "SENT");
  const sent = contact.messages.filter((m) => m.status === "SENT");
  const alumni = contact.vitAlumni || /\bVIT\b/i.test(contact.school || "");

  return (
    <article className={`bg-white rounded-xl border p-4 flex flex-col gap-3 ${contact.followUpDue ? "border-rose-200" : "border-slate-200"}`}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-slate-900">{contact.name}</h4>
          <p className="text-xs text-slate-600">
            {contact.role ? `${contact.role} · ` : ""}
            <span className="font-semibold">{contact.company}</span>
          </p>
          {contact.headline && <p className="text-[11px] text-slate-500 line-clamp-2">{contact.headline}</p>}
        </div>
        <PriorityPill score={contact.priority.score} breakdown={contact.priority.breakdown} />
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={contact.effectiveStatus} />
        {alumni && <AlumniBadge />}
        <PersonaBadge persona={contact.persona} />
        <SourceBadge source={contact.source} />
        {contact.verified ? <Badge tone="emerald">Verified by you</Badge> : <Badge tone="amber">Unverified</Badge>}
        {contact.noReply && <Badge tone="amber">No reply after follow-up</Badge>}
        {contact.applicationStage && <Badge>Your application: {contact.applicationStage.toLowerCase()}</Badge>}
      </div>

      <ContactLinks linkedinUrl={contact.linkedinUrl} xUrl={contact.xUrl} githubUrl={contact.githubUrl} email={contact.email} emailSource={contact.emailSource} />

      {contact.targetJob && (
        <p className="text-[11px] text-slate-600">
          Job:{" "}
          <a href={contact.targetJob.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-indigo-700 hover:underline">
            {contact.targetJob.title}
          </a>
          {contact.targetJob.isActive === false && <span className="text-slate-400"> (closed)</span>}
        </p>
      )}
      {(contact.nextFollowUpAt || contact.lastContactAt) && (
        <p className="text-[11px] text-slate-500">
          {contact.lastContactAt && `Last contact ${formatDate(contact.lastContactAt)}. `}
          {contact.nextFollowUpAt && (
            <span className={contact.followUpDue ? "text-rose-600 font-semibold" : ""}>
              {contact.followUpDue ? "Action due since" : "Next follow-up"} {formatDate(contact.nextFollowUpAt)}
            </span>
          )}
        </p>
      )}
      {contact.notes && <p className="text-[11px] text-slate-600 whitespace-pre-line bg-slate-50 rounded-md p-2">{contact.notes}</p>}

      {drafts.length > 0 && (
        <div className="space-y-1.5">
          <h5 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Drafts</h5>
          {drafts.map((m) => {
            const type = canonicalType(m.type);
            return (
              <div key={m.id} className="rounded-lg border border-slate-200 p-2 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-700">{MESSAGE_LABELS[m.type] || m.type}</span>
                  <div className="flex gap-1">
                    <CopyButton text={m.content} />
                    <button type="button" onClick={() => type && onDraft(contact, type, m)} className="px-2 py-0.5 rounded-md border border-slate-200 hover:bg-slate-50">
                      Edit
                    </button>
                    {type && (
                      <button type="button" onClick={() => onDraft(contact, type)} className="px-2 py-0.5 rounded-md border border-slate-200 hover:bg-slate-50">
                        Regenerate
                      </button>
                    )}
                    <button type="button" disabled={busy} onClick={() => markSent(m)} className="px-2 py-0.5 rounded-md bg-indigo-600 text-white">
                      Mark sent
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-slate-600 line-clamp-3 whitespace-pre-line">{m.content}</p>
              </div>
            );
          })}
        </div>
      )}

      {sent.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowHistory((s) => !s)} className="text-[11px] font-semibold text-slate-500 hover:text-slate-800">
            {showHistory ? "Hide" : "Show"} sent messages ({sent.length})
          </button>
          {showHistory &&
            sent.map((m) => (
              <div key={m.id} className="mt-1 rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
                <span className="font-semibold">{MESSAGE_LABELS[m.type] || m.type}</span>, sent {formatDate(m.sentAt)}
                <p className="whitespace-pre-line">{m.content}</p>
              </div>
            ))}
        </div>
      )}

      {error && <p className="text-[11px] text-rose-600">{error}</p>}

      <footer className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
        {contact.nextActions.map((a) =>
          a.kind === "draft" ? (
            <button
              key={`d-${a.value}`}
              type="button"
              onClick={() => onDraft(contact, a.value as MessageType)}
              className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
            >
              {a.label}
            </button>
          ) : (
            <button
              key={`s-${a.value}`}
              type="button"
              disabled={busy}
              onClick={() => transition(a.value)}
              className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
            >
              {a.label}
            </button>
          )
        )}
        <select
          aria-label={`Set status for ${contact.name}`}
          value=""
          disabled={busy}
          onChange={(e) => e.target.value && transition(e.target.value)}
          className="px-1.5 py-1 rounded-md text-[11px] border border-slate-200 bg-white"
        >
          <option value="">Set status…</option>
          {CONTACT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <span className="ml-auto flex gap-1.5">
          <button type="button" onClick={() => onEdit(contact)} className="px-2 py-1 rounded-md text-[11px] font-semibold text-slate-600 hover:bg-slate-100">
            Edit
          </button>
          {confirmDelete ? (
            <span className="flex items-center gap-1 text-[11px]">
              Delete?
              <button type="button" onClick={remove} disabled={busy} className="px-2 py-1 rounded-md bg-rose-600 text-white font-semibold">
                Yes, delete
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="px-2 py-1 rounded-md text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="px-2 py-1 rounded-md text-[11px] font-semibold text-rose-600 hover:bg-rose-50">
              Delete
            </button>
          )}
        </span>
      </footer>
    </article>
  );
}
