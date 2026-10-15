"use client";

import React, { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { Contact, GithubPeopleResult, GithubPerson, PeopleLink } from "./types";

type Props = {
  company: string;
  /** Called after a GitHub person is added as a contact. */
  onAdded?: (contact: Contact) => void;
  /** Lets the user add someone they found through a search link. */
  onQuickAdd?: () => void;
};

const GROUP_LABELS: Record<string, string> = {
  ALUMNI: "Alumni (start here)",
  ENGINEER: "Engineers",
  FULLSTACK: "Full-stack",
  RECRUITER: "Recruiters / talent",
  FOUNDER_CXO: "Founders / CTO",
  GENERAL: "Other places",
};
const GROUP_ORDER = ["ALUMNI", "ENGINEER", "FULLSTACK", "RECRUITER", "FOUNDER_CXO", "GENERAL"];

/**
 * "Find people at <company>": search links the user opens in their own browser (LinkedIn,
 * Google X-ray, X) plus public GitHub org members/contributors that can be added in one click.
 */
export default function CompanyPeoplePanel({ company, onAdded, onQuickAdd }: Props) {
  const [links, setLinks] = useState<PeopleLink[]>([]);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [github, setGithub] = useState<GithubPeopleResult | null>(null);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [orgOverride, setOrgOverride] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, string>>({});
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api<{ links: PeopleLink[] }>(`/api/networking/companies/${encodeURIComponent(company)}/people-links`, {
      query: { githubOrg: github?.org?.login },
      signal: controller.signal,
    })
      .then((r) => setLinks(r.links))
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setLinksError(errorMessage(err));
      });
    return () => controller.abort();
  }, [company, github?.org?.login]);

  const searchGithub = async (org?: string) => {
    try {
      setGithubLoading(true);
      setGithubError(null);
      const res = await api<GithubPeopleResult>(`/api/networking/companies/${encodeURIComponent(company)}/github-people`, {
        query: { org: org || undefined },
      });
      setGithub(res);
    } catch (err) {
      setGithubError(errorMessage(err));
    } finally {
      setGithubLoading(false);
    }
  };

  const addPerson = async (p: GithubPerson) => {
    try {
      setAdding(p.login);
      setAddError(null);
      const contact = await api<Contact>(`/api/networking/companies/${encodeURIComponent(company)}/github-people/add`, { body: { login: p.login } });
      setAdded((a) => ({ ...a, [p.login]: contact.id }));
      onAdded?.(contact);
    } catch (err) {
      setAddError(`${p.login}: ${errorMessage(err)}`);
    } finally {
      setAdding(null);
    }
  };

  const grouped = GROUP_ORDER.map((g) => ({ group: g, items: links.filter((l) => l.group === g) })).filter((g) => g.items.length);

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <p className="text-xs text-slate-500">
          These open searches in your browser. Job Agent never visits LinkedIn for you. When you find someone, copy their profile URL and add them.
        </p>
        {linksError && <p className="text-xs text-rose-600">{linksError}</p>}
        {grouped.map(({ group, items }) => (
          <div key={group}>
            <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{GROUP_LABELS[group] || group}</h4>
            <ul className="mt-1 space-y-1">
              {items.map((l) => (
                <li key={l.id} className="text-xs">
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-indigo-700 hover:underline">
                    {l.label}
                  </a>
                  <span className="text-slate-500"> · {l.description}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {onQuickAdd && (
          <button type="button" onClick={onQuickAdd} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
            Add someone you found
          </button>
        )}
      </section>

      <section className="space-y-2 border-t border-slate-100 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-bold text-slate-900 mr-auto">GitHub</h4>
          <input
            aria-label="GitHub organisation login"
            value={orgOverride}
            onChange={(e) => setOrgOverride(e.target.value)}
            placeholder="org login (optional)"
            className="px-2 py-1 text-xs border border-slate-300 rounded-md w-40"
          />
          <button
            type="button"
            disabled={githubLoading}
            onClick={() => searchGithub(orgOverride.trim() || undefined)}
            className="px-3 py-1 text-xs font-semibold rounded-md border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            {githubLoading ? "Searching…" : github ? "Search again" : "Find on GitHub"}
          </button>
        </div>
        <p className="text-[11px] text-slate-500">Public organisation members (or top contributors). Only what people published on GitHub is shown.</p>
        {githubError && <p className="text-xs text-rose-600">{githubError}</p>}
        {github && (
          <div className="space-y-2">
            {github.org && (
              <p className="text-xs text-slate-600">
                Organisation:{" "}
                <a href={github.org.htmlUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                  {github.org.name || github.org.login}
                </a>
              </p>
            )}
            {github.message && <p className={`text-xs ${github.rateLimited ? "text-amber-700" : "text-slate-600"}`}>{github.message}</p>}
            {!github.org && github.orgCandidates.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {github.orgCandidates.map((o) => (
                  <button
                    key={o.login}
                    type="button"
                    onClick={() => {
                      setOrgOverride(o.login);
                      void searchGithub(o.login);
                    }}
                    className="px-2 py-0.5 text-[11px] rounded-md border border-slate-300 hover:bg-slate-50"
                  >
                    Use {o.login}
                  </button>
                ))}
              </div>
            )}
            {addError && <p className="text-xs text-rose-600">{addError}</p>}
            <ul className="divide-y divide-slate-100">
              {github.people.map((p) => {
                const existing = added[p.login] || p.existingContactId;
                return (
                  <li key={p.login} className="py-2 flex items-start justify-between gap-3">
                    <div className="text-xs min-w-0">
                      <a href={p.htmlUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-slate-900 hover:underline">
                        {p.name || p.login}
                      </a>
                      {p.name && <span className="text-slate-500"> @{p.login}</span>}
                      <span className="ml-1 text-[10px] text-slate-500">{p.via === "member" ? "org member" : `contributor${p.contributions ? `, ${p.contributions} commits` : ""}`}</span>
                      {p.bio && <p className="text-slate-600 truncate">{p.bio}</p>}
                      <p className="text-slate-500">
                        {[p.company ? `Company on GitHub: ${p.company}${p.companyMatches ? "" : " (doesn't match)"}` : null, p.location, p.twitterUsername ? `X: @${p.twitterUsername}` : null, p.email ? `Public email: ${p.email}` : null, p.blog]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    {existing ? (
                      <span className="text-[11px] font-semibold text-emerald-700 shrink-0">Saved</span>
                    ) : (
                      <button
                        type="button"
                        disabled={adding === p.login}
                        onClick={() => addPerson(p)}
                        className="shrink-0 px-2 py-1 text-[11px] font-semibold rounded-md bg-slate-900 text-white disabled:opacity-50"
                      >
                        {adding === p.login ? "Adding…" : "Add"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
