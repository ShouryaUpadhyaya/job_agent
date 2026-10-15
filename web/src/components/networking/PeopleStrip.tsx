"use client";

import React, { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import CompanyPeoplePanel from "./CompanyPeoplePanel";
import MessageDraftModal from "./MessageDraftModal";
import QuickAddContact from "./QuickAddContact";
import { CompanyPeople, ContactSummary, PERSONA_LABELS } from "./types";
import { Modal, PriorityPill } from "./ui";

type Props = {
  company: string;
  companyKey: string;
  /** The application's job: used for quick-add and referral-ask drafts. */
  jobListingId?: string | null;
  /** Pre-fetched from GET /api/networking/by-company; fetched here when omitted. */
  data?: CompanyPeople | null;
  /** Called after contacts change (so a parent can refetch by-company counts). */
  onChanged?: () => void;
};

/**
 * Compact "people at this company" strip for an application card: counts, the top 3
 * contacts, quick add, "Find people" and a referral-ask draft per contact.
 */
export default function PeopleStrip({ company, companyKey, jobListingId, data, onChanged }: Props) {
  const [own, setOwn] = useState<CompanyPeople | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [finding, setFinding] = useState(false);
  const [drafting, setDrafting] = useState<ContactSummary | null>(null);

  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (data !== undefined) return;
    const controller = new AbortController();
    api<Record<string, CompanyPeople>>("/api/networking/by-company", { query: { keys: companyKey }, signal: controller.signal })
      .then((res) => {
        setOwn(res[companyKey] ?? { count: 0, alumniCount: 0, topContacts: [] });
        setError(null);
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setError(errorMessage(err));
      });
    return () => controller.abort();
  }, [data, companyKey, version]);

  const people = data ?? own;
  const changed = () => {
    setVersion((v) => v + 1);
    onChanged?.();
  };

  return (
    <div className="text-[11px] space-y-1.5" data-testid={`people-strip-${companyKey}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-700">
          {people ? `${people.count} ${people.count === 1 ? "person" : "people"}` : "People"}
          {people && people.alumniCount > 0 ? ` · ${people.alumniCount} VIT alumni` : ""}
        </span>
        <button type="button" onClick={() => setAdding(true)} className="px-1.5 py-0.5 rounded border border-slate-200 hover:bg-slate-50">
          + Add
        </button>
        <button type="button" onClick={() => setFinding(true)} className="px-1.5 py-0.5 rounded border border-slate-200 hover:bg-slate-50">
          Find people
        </button>
      </div>
      {error && <p className="text-rose-600">{error}</p>}
      {people && people.topContacts.length > 0 && (
        <ul className="space-y-1">
          {people.topContacts.map((c) => (
            <li key={c.id} className="flex items-center gap-1.5">
              <PriorityPill score={c.priority} />
              {c.linkedinUrl ? (
                <a href={c.linkedinUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-slate-800 hover:underline">
                  {c.name}
                </a>
              ) : (
                <span className="font-semibold text-slate-800">{c.name}</span>
              )}
              <span className="text-slate-500">
                {PERSONA_LABELS[c.persona] || c.persona}
                {c.vitAlumni ? " · alumni" : ""}
              </span>
              <button type="button" onClick={() => setDrafting(c)} className="ml-auto px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100">
                Draft referral ask
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <QuickAddContact
          defaults={{ company, targetJobId: jobListingId ?? null }}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            changed();
          }}
        />
      )}
      {finding && (
        <Modal title={`Find people at ${company}`} onClose={() => setFinding(false)} wide>
          <CompanyPeoplePanel
            company={company}
            onAdded={changed}
            onQuickAdd={() => {
              setFinding(false);
              setAdding(true);
            }}
          />
        </Modal>
      )}
      {drafting && (
        <MessageDraftModal
          contact={{ id: drafting.id, name: drafting.name, company: drafting.company }}
          type="REFERRAL_ASK"
          jobListingId={jobListingId}
          onClose={() => setDrafting(null)}
          onChanged={changed}
        />
      )}
    </div>
  );
}
