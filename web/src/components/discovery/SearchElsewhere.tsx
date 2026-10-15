"use client";

import React, { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { SearchLink, XSources } from "./types";

const GROUPS: { id: SearchLink["group"]; title: string; note: string }[] = [
  { id: "job-boards", title: "Job boards", note: "Prefilled from your profile. Opens in your browser; Job Agent never fetches these sites." },
  { id: "ats-search", title: "Company career pages (Google)", note: "Postings on ATS boards indexed in the past week." },
  { id: "social", title: "Social", note: "" },
];

export default function SearchElsewhere() {
  const [links, setLinks] = useState<SearchLink[]>([]);
  const [x, setX] = useState<XSources | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<{ links: SearchLink[] }>("/api/discovery/search-links"),
      api<XSources>("/api/discovery/x-sources"),
    ])
      .then(([l, xs]) => {
        if (cancelled) return;
        setLinks(l.links);
        setX(xs);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-6" data-testid="search-elsewhere">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Search elsewhere</h2>
        <p className="text-xs text-slate-500 mt-1">
          LinkedIn and Naukri jobs reach Job Agent through their job-alert emails (Gmail sync) or when you add them manually. Use these
          searches to browse them yourself.
        </p>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}

      {GROUPS.map((g) => {
        const items = links.filter((l) => l.group === g.id);
        if (!items.length) return null;
        return (
          <section key={g.id} className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="text-sm font-bold text-slate-800">{g.title}</h3>
            {g.note && <p className="text-[11px] text-slate-500 mt-0.5">{g.note}</p>}
            <ul className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
              {items.map((l) => (
                <li key={l.id}>
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block p-3 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors"
                  >
                    <span className="block text-xs font-semibold text-slate-800">{l.label} ↗</span>
                    <span className="block text-[11px] text-slate-500 mt-0.5">{l.description}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {x && (
        <section className="bg-white rounded-2xl border border-slate-200 p-5" data-testid="x-feeds">
          <h3 className="text-sm font-bold text-slate-800">Opportunity feeds on X</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Accounts found posting intern/fresher openings in India{x.checkedAt ? ` (checked ${x.checkedAt})` : ""}. Activity was not
            independently verified; check recent posts before relying on one.
          </p>
          {x.accounts.length === 0 && <p className="mt-3 text-xs text-slate-500">No verified accounts yet. Use the live search below.</p>}
          <ul className="mt-3 space-y-2">
            {x.accounts.map((a) => (
              <li key={a.handle} className="text-xs">
                <a href={a.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 hover:underline">
                  @{a.handle}
                </a>{" "}
                <span className="text-slate-500">— {a.name}.</span> <span className="text-slate-700">{a.posts}</span>
              </li>
            ))}
          </ul>
          <a
            href={x.searchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-block px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800"
          >
            Live X search for internship posts ↗
          </a>
        </section>
      )}
    </div>
  );
}
