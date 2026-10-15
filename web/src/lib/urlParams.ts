"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";

/**
 * Dashboard deep links: `/?tab=PIPELINE&id=…`, `/?tab=NETWORKING&companyKey=…` etc. are built by
 * the briefing, the Gmail summary and in-app links. Each tab reads the params addressed to it
 * with `useDeepLink(tab)`; the Dashboard drops them when you switch tabs.
 */
export const DEEP_LINK_PARAMS = ["id", "companyKey", "company"] as const;

export interface DeepLink {
  id: string | null;
  companyKey: string | null;
  company: string | null;
}

/** One query parameter of the current URL (null on the server). */
export function getUrlParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

// The URL only changes through full navigations or our own replaceState calls, so there is
// nothing to subscribe to; the snapshot is re-read on every render.
const noSubscribe = () => () => {};

/** The current URL's query parameters; empty during server rendering (hydration-safe). */
export function useUrlParams(): URLSearchParams {
  const search = useSyncExternalStore(
    noSubscribe,
    () => window.location.search,
    () => ""
  );
  return useMemo(() => new URLSearchParams(search), [search]);
}

/** Deep-link params for `tab`, or null when the URL has none or targets another tab. */
export function useDeepLink(tab: string): DeepLink | null {
  const params = useUrlParams();
  const id = params.get("id");
  const companyKey = params.get("companyKey");
  const company = params.get("company");
  const forTab = params.get("tab") === tab;
  return useMemo(
    () => (forTab && (id || companyKey || company) ? { id, companyKey, company } : null),
    [forTab, id, companyKey, company]
  );
}

/** Dashboard link to a tab and (optionally) one record on it. */
export function dashboardHref(tab: string, params: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams({ tab });
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  return `/?${q.toString()}`;
}

/** Removes the deep-link params from the address bar (keeps `tab`). */
export function clearDeepLinkParams(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  let changed = false;
  for (const p of DEEP_LINK_PARAMS) {
    if (url.searchParams.has(p)) {
      url.searchParams.delete(p);
      changed = true;
    }
  }
  if (changed) window.history.replaceState(null, "", url.toString());
}

/** DOM id for a deep-link target, e.g. `deeplink-application-<id>`. */
export const deepLinkElementId = (kind: string, id: string) => `deeplink-${kind}-${id}`;

/** Scrolls the deep-link target into view once it is rendered (`ready`). */
export function useScrollToDeepLink(kind: string, id: string | null | undefined, ready: boolean): void {
  useEffect(() => {
    if (!id || !ready) return;
    const el = document.getElementById(deepLinkElementId(kind, id));
    // scrollIntoView is missing in some test environments.
    el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [kind, id, ready]);
}

/** Ring classes for a highlighted deep-link target. */
export const HIGHLIGHT_CLASS = "ring-2 ring-amber-400 ring-offset-2";
