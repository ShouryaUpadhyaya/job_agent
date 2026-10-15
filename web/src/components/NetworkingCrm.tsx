"use client";

import React, { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import CompanyPeoplePanel from "./networking/CompanyPeoplePanel";
import ContactCard from "./networking/ContactCard";
import MessageDraftModal from "./networking/MessageDraftModal";
import QuickAddContact from "./networking/QuickAddContact";
import {
  CONTACT_STATUSES,
  Contact,
  Facets,
  MessageType,
  NetworkingMessage,
  PERSONAS,
  PERSONA_LABELS,
  SORTS,
  SOURCES,
  SOURCE_LABELS,
  STATUS_LABELS,
} from "./networking/types";
import { Modal } from "./networking/ui";

type Filters = {
  companyKey: string;
  persona: string;
  alumni: string;
  status: string;
  source: string;
  followUpDue: boolean;
  sort: string;
};

const EMPTY_FILTERS: Filters = { companyKey: "", persona: "", alumni: "", status: "", source: "", followUpDue: false, sort: "priority" };

type DuplicateGroup = { reason: string; contacts: { id: string; name: string; company: string }[] };

/** Debounces a value (used for the search box). */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function NetworkingCrm() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  /** Key of the request whose response is shown; "loading" while it lags the current one. */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const [reloadKey, setReloadKey] = useState(0);

  const [editing, setEditing] = useState<Contact | null>(null);
  const [adding, setAdding] = useState<{ company?: string } | null>(null);
  const [draft, setDraft] = useState<{ contact: Contact; type: MessageType; existing?: NetworkingMessage } | null>(null);
  const [findCompany, setFindCompany] = useState<string | null>(null);
  const [findInput, setFindInput] = useState("");
  const [confirmMerge, setConfirmMerge] = useState<string | null>(null);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const requestKey = JSON.stringify({ filters, q, reloadKey });
  const loading = loadedKey !== requestKey;

  // Contacts: refetch on filter/search change; abort the previous request so a slow,
  // stale response can never overwrite a newer one.
  useEffect(() => {
    const controller = new AbortController();
    const key = JSON.stringify({ filters, q, reloadKey });
    api<Contact[]>("/api/networking/contacts", {
      query: {
        companyKey: filters.companyKey,
        persona: filters.persona,
        alumni: filters.alumni,
        status: filters.status,
        source: filters.source,
        followUpDue: filters.followUpDue ? "true" : undefined,
        sort: filters.sort,
        q,
      },
      signal: controller.signal,
    })
      .then((data) => {
        setContacts(data);
        setError(null);
        setLoadedKey(key);
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        setError(errorMessage(err));
        setLoadedKey(key);
      });
    return () => controller.abort();
  }, [filters, q, reloadKey]);

  useEffect(() => {
    const controller = new AbortController();
    api<Facets>("/api/networking/facets", { signal: controller.signal })
      .then(setFacets)
      .catch(() => undefined);
    api<{ groups: DuplicateGroup[] }>("/api/networking/duplicates", { signal: controller.signal })
      .then((r) => setDuplicates(r.groups || []))
      .catch(() => undefined);
    return () => controller.abort();
  }, [reloadKey]);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const filtersActive = JSON.stringify({ ...filters, sort: "" }) !== JSON.stringify({ ...EMPTY_FILTERS, sort: "" }) || q !== "";

  const merge = async (group: DuplicateGroup) => {
    const [keep, ...others] = group.contacts;
    try {
      for (const o of others) await api(`/api/networking/contacts/${keep.id}/merge`, { body: { otherId: o.id } });
      setConfirmMerge(null);
      reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const select = "px-2 py-1.5 text-xs rounded-lg border border-slate-300 bg-white";
  const noContactsAtAll = facets?.total === 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Contacts", value: facets?.total ?? "–" },
          { label: "VIT alumni", value: facets?.alumni ?? "–" },
          { label: "Action due", value: facets?.followUpDue ?? "–" },
          { label: "Referred", value: facets?.status?.REFERRED ?? 0 },
        ].map((m) => (
          <div key={m.label} className="bg-white p-3 rounded-xl border border-slate-200">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{m.label}</p>
            <p className="text-xl font-bold text-slate-900">{m.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="Search contacts"
            placeholder="Search name, company, role, notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 w-64"
          />
          <select aria-label="Company" value={filters.companyKey} onChange={(e) => setFilter("companyKey", e.target.value)} className={select}>
            <option value="">All companies</option>
            {facets?.companies.map((c) => (
              <option key={c.companyKey} value={c.companyKey}>
                {c.company} ({c.count})
              </option>
            ))}
          </select>
          <select aria-label="Persona" value={filters.persona} onChange={(e) => setFilter("persona", e.target.value)} className={select}>
            <option value="">All personas</option>
            {PERSONAS.map((p) => (
              <option key={p} value={p}>
                {PERSONA_LABELS[p]}
              </option>
            ))}
          </select>
          <select aria-label="Status" value={filters.status} onChange={(e) => setFilter("status", e.target.value)} className={select}>
            <option value="">All statuses</option>
            {CONTACT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
                {facets?.status?.[s] ? ` (${facets.status[s]})` : ""}
              </option>
            ))}
          </select>
          <select aria-label="Source" value={filters.source} onChange={(e) => setFilter("source", e.target.value)} className={select}>
            <option value="">All sources</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
          <select aria-label="Alumni" value={filters.alumni} onChange={(e) => setFilter("alumni", e.target.value)} className={select}>
            <option value="">Alumni and others</option>
            <option value="true">VIT alumni only</option>
            <option value="false">Non-alumni</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <input type="checkbox" checked={filters.followUpDue} onChange={(e) => setFilter("followUpDue", e.target.checked)} />
            Action due
          </label>
          <select aria-label="Sort" value={filters.sort} onChange={(e) => setFilter("sort", e.target.value)} className={select}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                Sort: {s.label}
              </option>
            ))}
          </select>
          {filtersActive && (
            <button
              type="button"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setSearch("");
              }}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800"
            >
              Clear filters
            </button>
          )}
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={() => setFindCompany("")} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 hover:bg-slate-50">
              Find people at a company
            </button>
            <button type="button" onClick={() => setAdding({})} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
              Add contact
            </button>
          </span>
        </div>
      </div>

      {duplicates.length > 0 && (
        <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-900 space-y-1.5">
          <p className="font-semibold">Possible duplicates</p>
          {duplicates.map((g) => {
            const sig = g.contacts.map((c) => c.id).join(",");
            return (
              <div key={sig} className="flex flex-wrap items-center gap-2">
                <span>
                  {g.contacts.map((c) => `${c.name} (${c.company})`).join(" / ")}: {g.reason.toLowerCase()}
                </span>
                {confirmMerge === sig ? (
                  <>
                    <span>Merge into {g.contacts[0].name}?</span>
                    <button type="button" onClick={() => merge(g)} className="px-2 py-0.5 rounded bg-amber-600 text-white font-semibold">
                      Yes, merge
                    </button>
                    <button type="button" onClick={() => setConfirmMerge(null)} className="px-2 py-0.5 rounded border border-amber-300">
                      Cancel
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirmMerge(sig)} className="px-2 py-0.5 rounded border border-amber-300 bg-white font-semibold">
                    Merge
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-rose-600">
          {error}
        </p>
      )}

      {loading && contacts.length === 0 ? (
        <p className="text-center py-10 text-sm text-slate-400">Loading contacts…</p>
      ) : contacts.length === 0 ? (
        noContactsAtAll ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-3">
            <h3 className="text-base font-bold text-slate-800">No contacts yet</h3>
            <div className="text-xs text-slate-600 max-w-xl mx-auto space-y-1.5 text-left">
              <p>Job Agent only tracks real people you find. Three ways to add them:</p>
              <p>
                1. <strong>Find people at a company</strong>: opens LinkedIn, Google and X searches for VIT alumni, engineers, recruiters and founders there, and lists its
                public GitHub members you can add in one click.
              </p>
              <p>
                2. <strong>Add contact</strong>: paste their LinkedIn profile URL, name and headline.
              </p>
              <p>3. Gmail sync proposes recruiters who email you.</p>
              <p>Start with VIT alumni and engineers at companies you have applied to. They reply most often.</p>
            </div>
            <div className="flex justify-center gap-2">
              <button type="button" onClick={() => setFindCompany("")} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300">
                Find people at a company
              </button>
              <button type="button" onClick={() => setAdding({})} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white">
                Add contact
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">No contacts match these filters.</div>
        )
      ) : (
        <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 ${loading ? "opacity-60" : ""}`}>
          {contacts.map((c) => (
            <ContactCard
              key={c.id}
              contact={c}
              onChanged={reload}
              onEdit={setEditing}
              onDraft={(contact, type, existing) => setDraft({ contact, type, existing })}
            />
          ))}
        </div>
      )}

      {(adding || editing) && (
        <QuickAddContact
          contact={editing}
          defaults={adding ?? undefined}
          onClose={() => {
            setAdding(null);
            setEditing(null);
          }}
          onSaved={() => {
            setAdding(null);
            setEditing(null);
            reload();
          }}
          onOpenExisting={(c) => {
            setAdding(null);
            setEditing(c);
          }}
        />
      )}

      {draft && (
        <MessageDraftModal
          key={`${draft.contact.id}-${draft.type}-${draft.existing?.id ?? "new"}`}
          contact={draft.contact}
          type={draft.type}
          existing={draft.existing}
          jobListingId={draft.contact.targetJobId}
          onClose={() => setDraft(null)}
          onChanged={reload}
        />
      )}

      {findCompany !== null && (
        <Modal title={findCompany ? `Find people at ${findCompany}` : "Find people at a company"} onClose={() => setFindCompany(null)} wide>
          {findCompany ? (
            <CompanyPeoplePanel
              company={findCompany}
              onAdded={reload}
              onQuickAdd={() => {
                const company = findCompany;
                setFindCompany(null);
                setAdding({ company });
              }}
            />
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (findInput.trim()) setFindCompany(findInput.trim());
              }}
              className="flex gap-2"
            >
              <input
                aria-label="Company name"
                value={findInput}
                onChange={(e) => setFindInput(e.target.value)}
                placeholder="Company name, e.g. Razorpay"
                className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg"
              />
              <button type="submit" className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white">
                Search
              </button>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
