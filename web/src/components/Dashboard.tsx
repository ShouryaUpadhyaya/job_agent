"use client";

import React, { useState, useEffect } from "react";
import ApplicationCopilot from "./ApplicationCopilot";
import ApplicationsPipeline from "./ApplicationsPipeline";
import SourcesManager from "./SourcesManager";
import ProfileManager from "./ProfileManager";

export type Job = {
  id: string;
  title: string;
  company: string;
  location?: string;
  source?: string;
  url: string;
  description: string;
  score?: number;
  status?: string;
  matchReasons?: string[];
  matchedSkills?: string[];
  missingSkills?: string[];
  retrievedAt?: string;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<"DISCOVERY" | "PIPELINE" | "SOURCES" | "PROFILE">("DISCOVERY");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [pipelineMessage, setPipelineMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showCopilot, setShowCopilot] = useState(false);

  // Resume tailoring state
  const [tailoring, setTailoring] = useState(false);
  const [tailoredResumeData, setTailoredResumeData] = useState<{
    content: string;
    matchedSkills: string[];
    missingKeywords: string[];
    bullets: string[];
  } | null>(null);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE_URL}/api/jobs?sortBy=score&sortOrder=desc`);
      if (!res.ok) {
        throw new Error("Failed to fetch jobs");
      }
      const data = await res.json();
      setJobs(data);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An error occurred");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  const handleManualSync = async () => {
    try {
      setSyncing(true);
      setSyncMessage(null);
      const res = await fetch(`${API_BASE_URL}/api/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const data = await res.json();
      if (res.ok) {
        setSyncMessage(`Sync complete: ${data.summary?.totalNew || 0} new, ${data.summary?.totalUpdated || 0} updated`);
        await fetchJobs();
      } else {
        setSyncMessage(`Sync status: ${data.message || "Failed"}`);
      }
    } catch (err: any) {
      setSyncMessage(`Sync failed: ${err.message || "Network error"}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleBookmarkToPipeline = async (job: Job) => {
    try {
      setPipelineMessage(null);
      const res = await fetch(`${API_BASE_URL}/api/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobListingId: job.id,
          stage: "BOOKMARKED",
          notes: `Added from smart discovery match (${job.score ?? 0} pts)`,
        }),
      });
      if (res.ok) {
        setPipelineMessage(`✓ "${job.title}" saved to Application Pipeline!`);
      } else {
        setPipelineMessage("✗ Could not save to pipeline");
      }
    } catch (err: any) {
      setPipelineMessage(`✗ Error: ${err.message}`);
    }
  };

  const handleTailorResume = async (job: Job) => {
    try {
      setTailoring(true);
      setTailoredResumeData(null);
      const res = await fetch(`${API_BASE_URL}/api/copilot/tailor-resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobListingId: job.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setTailoredResumeData(data);
      } else {
        alert(data.error || "Failed to tailor resume");
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setTailoring(false);
    }
  };

  const filteredJobs = jobs.filter((job) => {
    const matchesFilter = filter === "ALL" || job.status === filter;
    const matchesSearch =
      searchQuery === "" ||
      job.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (job.location && job.location.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesFilter && matchesSearch;
  });

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case "APPLY":
        return "bg-emerald-100 text-emerald-800 border-emerald-300";
      case "REVIEW":
        return "bg-amber-100 text-amber-800 border-amber-300";
      case "SKIP":
        return "bg-gray-100 text-gray-600 border-gray-300";
      default:
        return "bg-blue-100 text-blue-800 border-blue-300";
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans">
      {/* Top Application Header & Navigation Bar */}
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

        <div className="flex space-x-1">
          <button
            onClick={() => setActiveTab("DISCOVERY")}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeTab === "DISCOVERY"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-300 hover:text-white hover:bg-slate-800"
            }`}
          >
            🎯 Job Discovery
          </button>
          <button
            onClick={() => setActiveTab("PIPELINE")}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeTab === "PIPELINE"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-300 hover:text-white hover:bg-slate-800"
            }`}
          >
            📋 Application Pipeline
          </button>
          <button
            onClick={() => setActiveTab("SOURCES")}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeTab === "SOURCES"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-300 hover:text-white hover:bg-slate-800"
            }`}
          >
            🏢 Target Companies
          </button>
          <button
            onClick={() => setActiveTab("PROFILE")}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeTab === "PROFILE"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-300 hover:text-white hover:bg-slate-800"
            }`}
          >
            👤 Profile & Resume
          </button>
        </div>
      </nav>

      {/* Main Tab Views */}
      {activeTab === "PIPELINE" && (
        <div className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto w-full">
          <ApplicationsPipeline />
        </div>
      )}

      {activeTab === "SOURCES" && (
        <div className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto w-full">
          <SourcesManager onSyncFinished={fetchJobs} />
        </div>
      )}

      {activeTab === "PROFILE" && (
        <div className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto w-full">
          <ProfileManager onProfileUpdated={fetchJobs} />
        </div>
      )}

      {activeTab === "DISCOVERY" && (
        <div className="flex flex-1 overflow-hidden">
          {/* Left Column: Job Feed & Filters */}
          <div className="w-1/3 border-r border-gray-200 bg-white overflow-y-auto flex flex-col">
            <header className="p-6 border-b border-gray-200 sticky top-0 bg-white z-10 shadow-xs">
              <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold tracking-tight text-gray-900">Job Feed</h1>
                <button
                  onClick={handleManualSync}
                  disabled={syncing}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-all shadow-xs ${
                    syncing
                      ? "bg-blue-100 text-blue-500 cursor-wait"
                      : "bg-blue-600 hover:bg-blue-700 text-white"
                  }`}
                >
                  <span>{syncing ? "Syncing..." : "Sync Jobs"}</span>
                  <span className={syncing ? "animate-spin" : ""}>🔄</span>
                </button>
              </div>

              <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                <p>Target: 2027 Internships (VIT &apos;28)</p>
                <span className="font-semibold text-gray-700">{jobs.length} total listings</span>
              </div>

              {syncMessage && (
                <div className="mt-2 p-2 text-xs bg-blue-50 text-blue-700 rounded-md border border-blue-200">
                  {syncMessage}
                </div>
              )}

              {/* Search Box */}
              <div className="mt-3">
                <input
                  type="text"
                  placeholder="Search title, company, or tech..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Category Tabs */}
              <div className="flex space-x-1.5 mt-3 pt-2 border-t border-gray-100">
                {["ALL", "APPLY", "REVIEW", "SKIP"].map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                      filter === f
                        ? "bg-gray-900 text-white shadow-xs"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </header>

            {loading && (
              <div className="p-8 text-center" data-testid="loading-state">
                <div className="inline-block h-6 w-6 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
                <p className="mt-4 text-gray-500">Loading jobs...</p>
              </div>
            )}

            {error && (
              <div className="p-8 text-center" data-testid="error-state">
                <div className="text-red-500 mb-2">
                  <svg className="w-8 h-8 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-red-600 font-medium">{error}</p>
                <button
                  onClick={() => fetchJobs()}
                  className="mt-4 px-4 py-2 bg-red-50 text-red-600 rounded-md text-sm font-medium hover:bg-red-100 transition-colors"
                >
                  Try again
                </button>
              </div>
            )}

            {!loading && !error && filteredJobs.length === 0 && (
              <div className="p-8 text-center" data-testid="empty-state">
                <div className="text-gray-400 mb-2">
                  <svg className="w-8 h-8 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                  </svg>
                </div>
                <p className="text-gray-500">No jobs available right now.</p>
                <button
                  onClick={handleManualSync}
                  className="mt-3 px-4 py-2 text-xs font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Run Ingestion Sync
                </button>
              </div>
            )}

            {!loading && !error && filteredJobs.length > 0 && (
              <ul className="divide-y divide-gray-100 flex-1">
                {filteredJobs.map((job) => (
                  <li key={job.id}>
                    <button
                      onClick={() => {
                        setSelectedJob(job);
                        setShowCopilot(false);
                        setTailoredResumeData(null);
                        setPipelineMessage(null);
                      }}
                      className={`w-full text-left p-5 transition-colors hover:bg-blue-50/60 focus:outline-none ${
                        selectedJob?.id === job.id
                          ? "bg-blue-50 border-l-4 border-blue-600"
                          : "border-l-4 border-transparent"
                      }`}
                      data-testid={`job-item-${job.id}`}
                    >
                      <div className="flex items-start justify-between">
                        <h3 className="font-semibold text-base text-gray-900 leading-snug">{job.title}</h3>
                        {job.status && (
                          <span
                            className={`ml-2 px-2 py-0.5 text-xs font-bold rounded-full border whitespace-nowrap ${getStatusBadge(
                              job.status
                            )}`}
                          >
                            {job.status}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex items-center text-xs text-gray-500 space-x-2">
                        <span className="font-medium text-gray-700">{job.company}</span>
                        <span>&bull;</span>
                        <span>{job.location || job.source || "Remote"}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs">
                        <span className="font-bold text-blue-700">
                          Match: {job.score ?? 0} pts
                        </span>
                        <span className="text-gray-400 text-[11px] font-mono">
                          {job.source || "Direct"}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Right Column: Job Details & Match Explanations */}
          <div className="w-2/3 bg-gray-50 overflow-y-auto">
            {selectedJob ? (
              <div className="max-w-3xl mx-auto p-10" data-testid="job-details">
                <div className="bg-white rounded-2xl shadow-xs border border-gray-200 p-8">
                  {/* Header */}
                  <div className="flex items-start justify-between border-b border-gray-100 pb-6">
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900 leading-tight">{selectedJob.title}</h2>
                      <div className="mt-2 flex items-center text-base text-gray-600 space-x-3">
                        <span className="font-semibold text-gray-900">{selectedJob.company}</span>
                        <span>&mdash;</span>
                        <span>{selectedJob.location || "Remote"}</span>
                      </div>
                    </div>
                    {selectedJob.status && (
                      <div className="text-right">
                        <span
                          className={`inline-block px-3 py-1 text-sm font-bold rounded-full border ${getStatusBadge(
                            selectedJob.status
                          )}`}
                        >
                          {selectedJob.status} ({selectedJob.score ?? 0} pts)
                        </span>
                        <p className="text-[11px] text-gray-400 mt-1 font-mono">Source: {selectedJob.source || "Public Feed"}</p>
                      </div>
                    )}
                  </div>

                  {/* Feedback Banner */}
                  {pipelineMessage && (
                    <div className="mt-4 p-3 bg-indigo-50 border border-indigo-200 text-indigo-800 rounded-xl text-xs font-semibold">
                      {pipelineMessage}
                    </div>
                  )}

                  {/* Verified Source Link */}
                  <div className="mt-4 flex items-center justify-between">
                    <a
                      href={selectedJob.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center space-x-1.5 text-sm font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      <span>View Verified Source Listing</span>
                      <span>&rarr;</span>
                    </a>
                  </div>

                  {/* Match Criteria & Explanations */}
                  <div className="mt-6 p-4 rounded-xl bg-blue-50/60 border border-blue-100">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-blue-900 mb-2">
                      Match Evaluation & Explainability
                    </h3>
                    {selectedJob.matchedSkills && selectedJob.matchedSkills.length > 0 && (
                      <div className="mb-2">
                        <span className="text-xs font-semibold text-gray-700 mr-2">Matched Skills:</span>
                        <div className="inline-flex flex-wrap gap-1 mt-1">
                          {selectedJob.matchedSkills.map((s) => (
                            <span key={s} className="px-2 py-0.5 text-xs font-medium rounded-md bg-emerald-100 text-emerald-800">
                              ✓ {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {selectedJob.matchReasons && selectedJob.matchReasons.length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs text-gray-700 list-disc list-inside">
                        {selectedJob.matchReasons.map((r, idx) => (
                          <li key={idx}>{r}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Job Description */}
                  <div className="mt-6 pt-6 border-t border-gray-100">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                      Job Description
                    </h3>
                    <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap leading-relaxed font-sans">
                      {selectedJob.description}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="mt-8 pt-6 border-t border-gray-100 flex flex-wrap items-center gap-3">
                    <button
                      onClick={() => handleBookmarkToPipeline(selectedJob)}
                      className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-sm font-semibold transition-colors flex items-center space-x-1.5"
                    >
                      <span>📌 Save to Pipeline</span>
                    </button>
                    <button
                      onClick={() => handleTailorResume(selectedJob)}
                      disabled={tailoring}
                      className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition-colors shadow-xs flex items-center space-x-1.5 disabled:opacity-50"
                    >
                      <span>{tailoring ? "Analyzing ATS..." : "🎯 Tailor Resume"}</span>
                    </button>
                    <button
                      onClick={() => setShowCopilot(!showCopilot)}
                      className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors shadow-xs flex items-center space-x-2"
                    >
                      <span>{showCopilot ? "Hide Copilot" : "Apply with Copilot"}</span>
                      <span>✨</span>
                    </button>
                  </div>

                  {/* Tailored Resume Panel */}
                  {tailoredResumeData && (
                    <div className="mt-6 p-6 rounded-2xl bg-emerald-50/60 border border-emerald-200 space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="font-bold text-emerald-900 text-sm">🎯 ATS Tailored Resume Recommendations</h4>
                        <span className="text-xs text-emerald-700 font-semibold">Grounded in Verified Profile</span>
                      </div>

                      {tailoredResumeData.missingKeywords.length > 0 && (
                        <div>
                          <span className="text-xs font-bold text-emerald-800">Keywords to Emphasize: </span>
                          <span className="text-xs text-slate-700">
                            {tailoredResumeData.missingKeywords.join(", ")}
                          </span>
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <span className="text-xs font-bold text-emerald-800">Targeted Impact Bullets:</span>
                        <ul className="text-xs text-slate-800 space-y-1 list-disc list-inside">
                          {tailoredResumeData.bullets.map((b, idx) => (
                            <li key={idx}>{b}</li>
                          ))}
                        </ul>
                      </div>

                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs font-bold text-emerald-800">Formatted Markdown Export:</span>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(tailoredResumeData.content);
                              alert("Tailored resume copied to clipboard!");
                            }}
                            className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900"
                          >
                            📋 Copy Markdown
                          </button>
                        </div>
                        <pre className="p-3 bg-white rounded-xl border border-emerald-200 text-xs font-mono overflow-x-auto text-slate-700 max-h-48 whitespace-pre-wrap">
                          {tailoredResumeData.content}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Integrated Copilot */}
                  {showCopilot && (
                    <div className="mt-8 pt-6 border-t border-gray-200">
                      <ApplicationCopilot
                        initialCoverLetter={`Dear Hiring Team at ${selectedJob.company},\n\nI am writing to express my strong interest in the ${selectedJob.title} position. As a B.Tech Computer Science student at VIT Vellore graduating in May 2028 with background in backend engineering, distributed systems, and full-stack development (TypeScript, Node.js, Express, PostgreSQL, Redis, Docker), I am confident I can contribute effectively to your team.\n\nThank you for considering my application.\n\nSincerely,\nShourya Upadhyaya`}
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400">
                <div className="text-center">
                  <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <p className="text-lg font-medium">Select a job to view details</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
