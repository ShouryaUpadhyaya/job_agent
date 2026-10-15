"use client";

import React, { useState, useEffect } from "react";
import JobDiscovery from "./JobDiscovery";
import ApplicationsPipeline from "./ApplicationsPipeline";
import ProfileManager from "./ProfileManager";
import NetworkingCrm from "./NetworkingCrm";
import GmailSync from "./GmailSync";
import DailyBriefing from "./DailyBriefing";
import WellfoundAutoApplyManager from "./WellfoundAutoApplyManager";

const TABS = [
  { id: "DISCOVERY", label: "🎯 Job Discovery" },
  { id: "WELLFOUND", label: "⚡ Wellfound AutoApply" },
  { id: "PIPELINE", label: "📋 Application Pipeline" },
  { id: "NETWORKING", label: "🤝 Networking CRM" },
  { id: "GMAIL", label: "📬 Gmail Sync" },
  { id: "BRIEFING", label: "📰 Daily Briefing" },
  { id: "PROFILE", label: "👤 Profile & Resume" },
] as const;

export type { Job } from "./discovery/types";

export type TabId = (typeof TABS)[number]["id"];

/** Active tab mirrored in `?tab=` so OAuth redirects and links land on the right view. */
function useTabParam(): [TabId, (tab: TabId) => void] {
  const [tab, setTab] = useState<TabId>("DISCOVERY");

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    // Source management moved into Job Discovery; old ?tab=SOURCES links open it there.
    const mapped = fromUrl === "SOURCES" ? "DISCOVERY" : fromUrl;
    // Read after hydration (the server render has no URL), so a one-off sync setState is intended.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (mapped && TABS.some((t) => t.id === mapped)) setTab(mapped as TabId);
  }, []);

  const select = (next: TabId) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    url.searchParams.delete("sources");
    window.history.replaceState(null, "", url.toString());
  };

  return [tab, select];
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useTabParam();
  // Bumped when another tab changes data the job feed depends on (sources, profile).
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshJobs = () => setRefreshKey((k) => k + 1);
  // `?tab=SOURCES` (old tab) or `?sources=1` opens the Manage sources drawer once.
  const [sourcesDeepLink, setSourcesDeepLink] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "SOURCES" || params.get("sources") === "1") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSourcesDeepLink(true);
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "DISCOVERY");
      url.searchParams.delete("sources");
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans">
      <nav className="bg-slate-900 text-white border-b border-slate-800 px-6 py-3 flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center space-x-3">
          <span className="text-xl">🚀</span>
          <div>
            <span className="font-extrabold text-base tracking-tight text-white">Job-Agent</span>
            <span className="ml-2 text-[11px] font-semibold uppercase tracking-wider text-indigo-400 bg-indigo-950/80 px-2 py-0.5 rounded-full border border-indigo-800/60">
              Autonomous Assistant
            </span>
          </div>
        </div>

        <div className="flex space-x-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-300 hover:text-white hover:bg-slate-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {activeTab === "DISCOVERY" && <JobDiscovery refreshKey={refreshKey} initialSourcesOpen={sourcesDeepLink} />}

      {activeTab === "WELLFOUND" && (
        <div className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto w-full">
          <WellfoundAutoApplyManager />
        </div>
      )}

      {activeTab === "PIPELINE" && (
        <div className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto w-full">
          <ApplicationsPipeline />
        </div>
      )}

      {activeTab === "NETWORKING" && (
        <div className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto w-full">
          <NetworkingCrm />
        </div>
      )}

      {activeTab === "GMAIL" && (
        <div className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto w-full">
          <GmailSync />
        </div>
      )}

      {activeTab === "BRIEFING" && (
        <div className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto w-full">
          <DailyBriefing />
        </div>
      )}

      {activeTab === "PROFILE" && (
        <div className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto w-full">
          <ProfileManager onProfileUpdated={refreshJobs} />
        </div>
      )}
    </div>
  );
}
