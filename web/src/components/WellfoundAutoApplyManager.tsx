"use client";

import React, { useState, useEffect } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export interface WellfoundAppRow {
  date: string;
  site: string;
  role: string;
  company: string;
  salary?: string;
  skills?: string;
  link?: string;
  jd?: string;
}

export interface WellfoundConfigState {
  env: Record<string, string>;
  dailyState: { date: string; count: number };
  totalCsvApplications: number;
  runnerState: {
    isRunning: boolean;
    mode: "DRY_RUN" | "LIVE" | null;
    visible: boolean;
    max: number;
    startedAt: string | null;
    logTail: string[];
  };
}

export default function WellfoundAutoApplyManager() {
  const [config, setConfig] = useState<WellfoundConfigState | null>(null);
  const [applications, setApplications] = useState<WellfoundAppRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncingDb, setSyncingDb] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  // Runner controls
  const [runMode, setRunMode] = useState<"DRY_RUN" | "LIVE">("DRY_RUN");
  const [runVisible, setRunVisible] = useState(true);
  const [runMax, setRunMax] = useState(5);
  const [actionLoading, setActionLoading] = useState(false);

  // Form edit fields
  const [formData, setFormData] = useState({
    NAME: "",
    EMAIL: "",
    PHONE: "",
    LOCATION: "",
    CURRENT_ROLE: "",
    COMPANY: "",
    EDUCATION: "",
    YEARS_EXPERIENCE: "",
    SKILLS: "",
    HIGHLIGHTS: "",
    NOTICE_PERIOD: "",
    CURRENT_CTC: "",
    EXPECTED_CTC: "",
    DOB: "",
    GENDER: "",
    WORK_AUTH: "",
    GITHUB_URL: "",
    LINKEDIN_URL: "",
    PORTFOLIO_URL: "",
    GEMINI_KEY: "",
  });

  const [activeSubTab, setActiveSubTab] = useState<"APPLICATIONS" | "RUNNER" | "PROFILE_CONFIG" | "ZEN_SCRIPT">("APPLICATIONS");
  const [zenScriptText, setZenScriptText] = useState("");
  const [copiedScript, setCopiedScript] = useState(false);

  const fetchConfigAndApps = async () => {
    try {
      setLoading(true);
      const [cfgRes, appsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/wellfound/config`),
        fetch(`${API_BASE_URL}/api/wellfound/applications`),
      ]);

      if (cfgRes.ok) {
        const cfgData: WellfoundConfigState = await cfgRes.json();
        setConfig(cfgData);
        setFormData({
          NAME: cfgData.env.NAME || "",
          EMAIL: cfgData.env.EMAIL || "",
          PHONE: cfgData.env.PHONE || "",
          LOCATION: cfgData.env.LOCATION || "",
          CURRENT_ROLE: cfgData.env.CURRENT_ROLE || "",
          COMPANY: cfgData.env.COMPANY || "",
          EDUCATION: cfgData.env.EDUCATION || "",
          YEARS_EXPERIENCE: cfgData.env.YEARS_EXPERIENCE || "",
          SKILLS: cfgData.env.SKILLS || "",
          HIGHLIGHTS: cfgData.env.HIGHLIGHTS || "",
          NOTICE_PERIOD: cfgData.env.NOTICE_PERIOD || "",
          CURRENT_CTC: cfgData.env.CURRENT_CTC || "0",
          EXPECTED_CTC: cfgData.env.EXPECTED_CTC || "6-10",
          DOB: cfgData.env.DOB || "",
          GENDER: cfgData.env.GENDER || "Male",
          WORK_AUTH: cfgData.env.WORK_AUTH || "",
          GITHUB_URL: cfgData.env.GITHUB_URL || "",
          LINKEDIN_URL: cfgData.env.LINKEDIN_URL || "",
          PORTFOLIO_URL: cfgData.env.PORTFOLIO_URL || "",
          GEMINI_KEY: cfgData.env.GEMINI_KEY || "",
        });
      }

      if (appsRes.ok) {
        const appsData = await appsRes.json();
        setApplications(appsData.applications || []);
      }
    } catch (err: any) {
      setStatusMessage({ type: "error", text: `Failed to load Wellfound data: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfigAndApps();
  }, []);

  // Poll runner status if active
  useEffect(() => {
    if (!config?.runnerState.isRunning) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/wellfound/config`);
        if (res.ok) {
          const cfgData: WellfoundConfigState = await res.json();
          setConfig(cfgData);
          if (!cfgData.runnerState.isRunning) {
            // Refresh applications table when runner finishes
            const appsRes = await fetch(`${API_BASE_URL}/api/wellfound/applications`);
            if (appsRes.ok) {
              const appsData = await appsRes.json();
              setApplications(appsData.applications || []);
            }
          }
        }
      } catch (e) {}
    }, 2500);
    return () => clearInterval(interval);
  }, [config?.runnerState.isRunning]);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setStatusMessage(null);
      const res = await fetch(`${API_BASE_URL}/api/wellfound/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (res.ok) {
        setStatusMessage({ type: "success", text: "Configuration saved and build regenerated successfully!" });
        await fetchConfigAndApps();
      } else {
        setStatusMessage({ type: "error", text: data.error || "Failed to save configuration" });
      }
    } catch (err: any) {
      setStatusMessage({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleSyncDatabase = async () => {
    try {
      setSyncingDb(true);
      setStatusMessage(null);
      const res = await fetch(`${API_BASE_URL}/api/wellfound/sync-database`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const { totalRows, newImported, alreadyTracked, contactsCreated } = data.result;
        setStatusMessage({
          type: "success",
          text: `Synced ${totalRows} applications to Database: ${newImported} new imported, ${alreadyTracked} already tracked, ${contactsCreated} networking contacts created!`,
        });
      } else {
        setStatusMessage({ type: "error", text: data.error || "Failed to sync to database" });
      }
    } catch (err: any) {
      setStatusMessage({ type: "error", text: err.message });
    } finally {
      setSyncingDb(false);
    }
  };

  const handleStartRunner = async () => {
    try {
      setActionLoading(true);
      setStatusMessage(null);
      const res = await fetch(`${API_BASE_URL}/api/wellfound/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: runMode,
          visible: runVisible,
          max: runMax,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatusMessage({
          type: "info",
          text: `Launched Wellfound AutoApply in ${runMode} mode (Visible=${runVisible}, Target=${runMax})`,
        });
        await fetchConfigAndApps();
      } else {
        setStatusMessage({ type: "error", text: data.error || "Failed to launch runner" });
      }
    } catch (err: any) {
      setStatusMessage({ type: "error", text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleStopRunner = async () => {
    try {
      setActionLoading(true);
      const res = await fetch(`${API_BASE_URL}/api/wellfound/stop`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setStatusMessage({ type: "info", text: "Automation runner stopped." });
        await fetchConfigAndApps();
      } else {
        setStatusMessage({ type: "error", text: data.message || "Failed to stop runner" });
      }
    } catch (err: any) {
      setStatusMessage({ type: "error", text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const loadZenScript = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/wellfound/script`);
      if (res.ok) {
        const text = await res.text();
        setZenScriptText(text);
      }
    } catch (err) {}
  };

  const copyZenScriptToClipboard = async () => {
    if (!zenScriptText) {
      await loadZenScript();
    }
    navigator.clipboard.writeText(zenScriptText);
    setCopiedScript(true);
    setTimeout(() => setCopiedScript(false), 2500);
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Overview */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-3">
              <span className="text-2xl">⚡</span>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                Wellfound AutoApply Control Center
              </h1>
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                Playwright & Zen Engine
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Manage automatic job applications, Gemini AI-tailored cover letters, profile answers, and database sync.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={handleSyncDatabase}
              disabled={syncingDb}
              className={`px-4 py-2 text-xs font-bold rounded-xl flex items-center space-x-2 transition-all shadow-sm ${
                syncingDb
                  ? "bg-indigo-100 text-indigo-500 cursor-wait"
                  : "bg-indigo-600 hover:bg-indigo-700 text-white"
              }`}
            >
              <span>{syncingDb ? "Syncing to DB..." : "📥 Sync to App Database"}</span>
            </button>
            <button
              onClick={fetchConfigAndApps}
              className="px-3 py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all"
            >
              🔄 Refresh
            </button>
          </div>
        </div>

        {/* Status Banners */}
        {statusMessage && (
          <div
            className={`mt-4 p-4 rounded-xl text-sm border flex items-center justify-between ${
              statusMessage.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : statusMessage.type === "error"
                ? "bg-rose-50 border-rose-200 text-rose-800"
                : "bg-blue-50 border-blue-200 text-blue-800"
            }`}
          >
            <span>{statusMessage.text}</span>
            <button
              onClick={() => setStatusMessage(null)}
              className="text-xs font-bold ml-4 underline opacity-75 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Applied</span>
            <div className="mt-2 flex items-baseline space-x-2">
              <span className="text-2xl font-extrabold text-slate-900">{applications.length}</span>
              <span className="text-xs text-slate-500">recorded roles</span>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Today&apos;s Applications</span>
            <div className="mt-2 flex items-baseline space-x-2">
              <span className="text-2xl font-extrabold text-emerald-700">
                {config?.dailyState?.count || 0}
              </span>
              <span className="text-xs text-slate-500">/ 25 daily cap</span>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Target Focus</span>
            <div className="mt-2 flex items-baseline space-x-2">
              <span className="text-base font-bold text-indigo-700">Intern &amp; Fresher</span>
              <span className="text-xs text-slate-500">priority #1</span>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Runner Status</span>
            <div className="mt-2 flex items-center space-x-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  config?.runnerState.isRunning ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
                }`}
              />
              <span className="text-sm font-bold text-slate-800">
                {config?.runnerState.isRunning
                  ? `${config.runnerState.mode} (Active)`
                  : "Idle (Ready)"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex space-x-1 border-b border-slate-200 bg-white px-4 rounded-t-xl">
        <button
          onClick={() => setActiveSubTab("APPLICATIONS")}
          className={`py-3 px-4 text-xs font-bold border-b-2 transition-all ${
            activeSubTab === "APPLICATIONS"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          📋 Applied Roles ({applications.length})
        </button>
        <button
          onClick={() => setActiveSubTab("RUNNER")}
          className={`py-3 px-4 text-xs font-bold border-b-2 transition-all ${
            activeSubTab === "RUNNER"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          🚀 Automation Runner &amp; Live Logs
        </button>
        <button
          onClick={() => setActiveSubTab("PROFILE_CONFIG")}
          className={`py-3 px-4 text-xs font-bold border-b-2 transition-all ${
            activeSubTab === "PROFILE_CONFIG"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          ⚙️ Application Profile &amp; Rules (.env)
        </button>
        <button
          onClick={() => {
            setActiveSubTab("ZEN_SCRIPT");
            loadZenScript();
          }}
          className={`py-3 px-4 text-xs font-bold border-b-2 transition-all ${
            activeSubTab === "ZEN_SCRIPT"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          🌐 Zen Browser Console Script
        </button>
      </div>

      {/* Tab 1: Applications Table */}
      {activeSubTab === "APPLICATIONS" && (
        <div className="bg-white border border-slate-200 rounded-b-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-slate-900">
              Submitted Roles Log (`applications.csv`)
            </h2>
            <div className="text-xs text-slate-500">
              Auto-tracked and ready to sync to the pipeline &amp; networking contact list.
            </div>
          </div>

          {applications.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl">
              <span className="text-3xl">📭</span>
              <p className="mt-2 text-sm font-semibold text-slate-700">No applications recorded yet</p>
              <p className="text-xs text-slate-400 mt-1">
                Run the automation runner or paste the Zen script to start applying!
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-slate-700 uppercase font-semibold text-[11px] border-y border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Date Applied</th>
                    <th className="py-3 px-4">Company</th>
                    <th className="py-3 px-4">Role Title</th>
                    <th className="py-3 px-4">Compensation</th>
                    <th className="py-3 px-4">Skills Matched</th>
                    <th className="py-3 px-4">Job Link</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {applications.map((app, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 whitespace-nowrap font-medium text-slate-800">
                        {app.date}
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-900">
                        {app.company.replace(/(?:Actively\s*Hiring|Promoted|Hiring|Employees|\d+-\d+\s*Employees).*/i, "").trim() || app.company}
                      </td>
                      <td className="py-3 px-4 font-semibold text-indigo-700">{app.role}</td>
                      <td className="py-3 px-4 whitespace-nowrap text-emerald-700 font-medium">
                        {app.salary || "Not Specified"}
                      </td>
                      <td className="py-3 px-4">
                        {app.skills ? (
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {app.skills.split(";").map((sk, sIdx) => (
                              <span
                                key={sIdx}
                                className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px]"
                              >
                                {sk.trim()}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">None</span>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {app.link && app.link.startsWith("http") ? (
                          <a
                            href={app.link.split("|")[0].trim()}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-600 hover:text-indigo-800 underline font-medium"
                          >
                            Open Link ↗
                          </a>
                        ) : (
                          <span className="text-slate-400">N/A</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Automation Runner Controls */}
      {activeSubTab === "RUNNER" && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-b-2xl p-6 shadow-sm">
            <h2 className="text-base font-bold text-slate-900 mb-4">
              Playwright Runner Execution Options
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Option 1: Mode */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700 uppercase">
                  Run Mode
                </label>
                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={() => setRunMode("DRY_RUN")}
                    className={`flex-1 py-2 px-3 text-xs font-bold rounded-xl border transition-all ${
                      runMode === "DRY_RUN"
                        ? "bg-amber-50 border-amber-300 text-amber-900 shadow-xs"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    🔍 Dry Run (Safe Test)
                  </button>
                  <button
                    type="button"
                    onClick={() => setRunMode("LIVE")}
                    className={`flex-1 py-2 px-3 text-xs font-bold rounded-xl border transition-all ${
                      runMode === "LIVE"
                        ? "bg-emerald-50 border-emerald-300 text-emerald-900 shadow-xs"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    🚀 Live (Submit)
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  {runMode === "DRY_RUN"
                    ? "Fills out forms and generates Gemini notes, but does not click Apply."
                    : "Actually clicks Apply, logs each role, and saves to database."}
                </p>
              </div>

              {/* Option 2: Browser Visibility */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700 uppercase">
                  Browser Visibility
                </label>
                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={() => setRunVisible(true)}
                    className={`flex-1 py-2 px-3 text-xs font-bold rounded-xl border transition-all ${
                      runVisible
                        ? "bg-indigo-50 border-indigo-300 text-indigo-900 shadow-xs"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    🖥️ Visible Window
                  </button>
                  <button
                    type="button"
                    onClick={() => setRunVisible(false)}
                    className={`flex-1 py-2 px-3 text-xs font-bold rounded-xl border transition-all ${
                      !runVisible
                        ? "bg-indigo-50 border-indigo-300 text-indigo-900 shadow-xs"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    🕶️ Background
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  {runVisible
                    ? "Opens Chrome on screen so you can watch human typing and actions."
                    : "Runs off-screen quietly in the background."}
                </p>
              </div>

              {/* Option 3: Target Batch Limit */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700 uppercase">
                  Batch Size ({runMax} applications)
                </label>
                <input
                  type="range"
                  min="1"
                  max="25"
                  value={runMax}
                  onChange={(e) => setRunMax(Number(e.target.value))}
                  className="w-full accent-indigo-600"
                />
                <div className="flex justify-between text-[11px] text-slate-500 font-medium">
                  <span>1 role</span>
                  <span>5 roles</span>
                  <span>10 roles</span>
                  <span>25 cap</span>
                </div>
              </div>
            </div>

            {/* Launch / Stop Actions */}
            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
              <div className="text-xs text-slate-500">
                Uses isolated Playwright profile (`.wellfound-chrome-profile/`).
              </div>
              <div className="flex items-center space-x-3">
                {config?.runnerState.isRunning ? (
                  <button
                    onClick={handleStopRunner}
                    disabled={actionLoading}
                    className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl transition-all shadow-sm flex items-center space-x-2"
                  >
                    <span>⏹ Stop Automation Runner</span>
                  </button>
                ) : (
                  <button
                    onClick={handleStartRunner}
                    disabled={actionLoading}
                    className={`px-5 py-2.5 font-bold text-xs rounded-xl transition-all shadow-sm flex items-center space-x-2 ${
                      runMode === "LIVE"
                        ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                        : "bg-amber-600 hover:bg-amber-700 text-white"
                    }`}
                  >
                    <span>{runMode === "LIVE" ? "🚀 Launch Live Runner" : "🔍 Start Dry-Run"}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Live Runner Logs */}
          <div className="bg-slate-950 text-slate-200 border border-slate-800 rounded-2xl p-5 font-mono text-xs shadow-md">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800 text-slate-400">
              <div className="flex items-center space-x-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-bold text-slate-200">Runner Output Stream</span>
              </div>
              <span>{config?.runnerState.logTail.length || 0} entries</span>
            </div>
            <div className="max-h-80 overflow-y-auto space-y-1 select-text">
              {(!config?.runnerState.logTail || config.runnerState.logTail.length === 0) ? (
                <div className="text-slate-500 italic py-4">No runner activity recorded yet. Click Launch above to start.</div>
              ) : (
                config.runnerState.logTail.map((log, idx) => (
                  <div
                    key={idx}
                    className={`leading-relaxed ${
                      log.includes("sent") || log.includes("submitted")
                        ? "text-emerald-400 font-semibold"
                        : log.includes("error") || log.includes("Error")
                        ? "text-rose-400"
                        : log.includes("Gemini")
                        ? "text-indigo-400"
                        : "text-slate-300"
                    }`}
                  >
                    {log}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Configuration & Profile Editing */}
      {activeSubTab === "PROFILE_CONFIG" && (
        <form onSubmit={handleSaveConfig} className="bg-white border border-slate-200 rounded-b-2xl p-6 shadow-sm space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-200">
            <div>
              <h2 className="text-base font-bold text-slate-900">Application Configuration &amp; Personal Info</h2>
              <p className="text-xs text-slate-500">
                All changes are automatically synced to `wellfound_autoApply/.env` and regenerate the auto-apply scripts.
              </p>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition-all shadow-sm"
            >
              {saving ? "Saving & Building..." : "💾 Save Changes"}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Full Name</label>
              <input
                type="text"
                value={formData.NAME}
                onChange={(e) => setFormData({ ...formData, NAME: e.target.value })}
                className="w-full text-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Email</label>
              <input
                type="email"
                value={formData.EMAIL}
                onChange={(e) => setFormData({ ...formData, EMAIL: e.target.value })}
                className="w-full text-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Phone Number</label>
              <input
                type="text"
                value={formData.PHONE}
                onChange={(e) => setFormData({ ...formData, PHONE: e.target.value })}
                className="w-full text-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Location</label>
              <input
                type="text"
                value={formData.LOCATION}
                onChange={(e) => setFormData({ ...formData, LOCATION: e.target.value })}
                className="w-full text-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Current Role Description</label>
              <input
                type="text"
                value={formData.CURRENT_ROLE}
                onChange={(e) => setFormData({ ...formData, CURRENT_ROLE: e.target.value })}
                className="w-full text-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Company / Team</label>
              <input
                type="text"
                value={formData.COMPANY}
                onChange={(e) => setFormData({ ...formData, COMPANY: e.target.value })}
                className="w-full text-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Education</label>
              <input
                type="text"
                value={formData.EDUCATION}
                onChange={(e) => setFormData({ ...formData, EDUCATION: e.target.value })}
                className="w-full text-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Years of Experience</label>
              <input
                type="text"
                value={formData.YEARS_EXPERIENCE}
                onChange={(e) => setFormData({ ...formData, YEARS_EXPERIENCE: e.target.value })}
                className="w-full text-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">Skills (comma separated)</label>
              <input
                type="text"
                value={formData.SKILLS}
                onChange={(e) => setFormData({ ...formData, SKILLS: e.target.value })}
                className="w-full text-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">Resume Highlights (separated by ||)</label>
              <textarea
                rows={3}
                value={formData.HIGHLIGHTS}
                onChange={(e) => setFormData({ ...formData, HIGHLIGHTS: e.target.value })}
                className="w-full text-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Notice Period</label>
              <input
                type="text"
                value={formData.NOTICE_PERIOD}
                onChange={(e) => setFormData({ ...formData, NOTICE_PERIOD: e.target.value })}
                className="w-full text-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Expected CTC / Stipend</label>
              <input
                type="text"
                value={formData.EXPECTED_CTC}
                onChange={(e) => setFormData({ ...formData, EXPECTED_CTC: e.target.value })}
                className="w-full text-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Date of Birth</label>
              <input
                type="text"
                value={formData.DOB}
                onChange={(e) => setFormData({ ...formData, DOB: e.target.value })}
                className="w-full text-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Gender</label>
              <input
                type="text"
                value={formData.GENDER}
                onChange={(e) => setFormData({ ...formData, GENDER: e.target.value })}
                className="w-full text-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">GitHub URL</label>
              <input
                type="text"
                value={formData.GITHUB_URL}
                onChange={(e) => setFormData({ ...formData, GITHUB_URL: e.target.value })}
                className="w-full text-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">LinkedIn URL</label>
              <input
                type="text"
                value={formData.LINKEDIN_URL}
                onChange={(e) => setFormData({ ...formData, LINKEDIN_URL: e.target.value })}
                className="w-full text-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">Gemini API Key (for Cover Letters &amp; Answers)</label>
              <input
                type="password"
                value={formData.GEMINI_KEY}
                onChange={(e) => setFormData({ ...formData, GEMINI_KEY: e.target.value })}
                className="w-full text-xs px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition-all shadow-sm"
            >
              {saving ? "Saving & Building..." : "💾 Save Changes"}
            </button>
          </div>
        </form>
      )}

      {/* Tab 4: Zen Browser Script */}
      {activeSubTab === "ZEN_SCRIPT" && (
        <div className="bg-white border border-slate-200 rounded-b-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Zen / Firefox Browser Injected Script
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Paste this into the DevTools Console on `wellfound.com/jobs` to run with human biometrics directly in your active browser.
              </p>
            </div>
            <button
              onClick={copyZenScriptToClipboard}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center space-x-1.5"
            >
              <span>{copiedScript ? "✓ Copied to Clipboard!" : "📋 Copy Script"}</span>
            </button>
          </div>

          <div className="bg-slate-900 text-slate-200 rounded-xl p-4 font-mono text-[11px] max-h-96 overflow-y-auto leading-relaxed border border-slate-800">
            <pre className="whitespace-pre-wrap select-all">
              {zenScriptText || "// Click Copy Script above or refresh to preview..."}
            </pre>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
            <strong>How to use in Zen:</strong> Log in to `wellfound.com/jobs`, open Console (F12), type{" "}
            <code>allow pasting</code>, then paste this script and hit Enter.
          </div>
        </div>
      )}
    </div>
  );
}
