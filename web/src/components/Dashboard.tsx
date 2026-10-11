"use client";

import React, { useState, useEffect } from "react";
import ApplicationCopilot from "./ApplicationCopilot";

export type Job = {
  id: string;
  title: string;
  company: string;
  location?: string;
  source?: string;
  url?: string;
  description: string;
  score?: number;
  status?: string;
};

export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("ALL");
  const [showCopilot, setShowCopilot] = useState(false);

  useEffect(() => {
    const fetchJobs = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("http://localhost:3001/api/jobs");
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

    fetchJobs();
  }, []);

  const filteredJobs = jobs.filter((job) => {
    if (filter === "ALL") return true;
    return job.status === filter;
  });

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case "APPLY":
        return "bg-emerald-100 text-emerald-800 border-emerald-200";
      case "REVIEW":
        return "bg-amber-100 text-amber-800 border-amber-200";
      case "SKIP":
        return "bg-gray-100 text-gray-600 border-gray-200";
      default:
        return "bg-blue-100 text-blue-800 border-blue-200";
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900 font-sans">
      {/* Left Sidebar: Job Feed */}
      <div className="w-1/3 border-r border-gray-200 bg-white overflow-y-auto flex flex-col">
        <header className="p-6 border-b border-gray-200 sticky top-0 bg-white z-10 shadow-sm">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Job Feed</h1>
            <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              Shourya (VIT '28)
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">Autonomous Multi-Agent Matcher</p>

          {/* Filter Bar */}
          <div className="flex space-x-2 mt-4 pt-2 border-t border-gray-100">
            {["ALL", "APPLY", "REVIEW", "SKIP"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                  filter === f
                    ? "bg-blue-600 text-white shadow-sm"
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
              onClick={() => window.location.reload()}
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
                  }}
                  className={`w-full text-left p-6 transition-colors hover:bg-blue-50 focus:outline-none ${
                    selectedJob?.id === job.id
                      ? "bg-blue-50 border-l-4 border-blue-600"
                      : "border-l-4 border-transparent"
                  }`}
                  data-testid={`job-item-${job.id}`}
                >
                  <div className="flex items-start justify-between">
                    <h3 className="font-semibold text-lg text-gray-900 leading-tight">{job.title}</h3>
                    {job.status && (
                      <span
                        className={`ml-2 px-2.5 py-0.5 text-xs font-bold rounded-full border ${getStatusBadge(
                          job.status
                        )}`}
                      >
                        {job.status}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center text-sm text-gray-500 space-x-2">
                    <span className="font-medium text-gray-700">{job.company}</span>
                    <span>&bull;</span>
                    <span>{job.location || job.source || "India / Remote"}</span>
                  </div>
                  {job.score !== undefined && (
                    <div className="mt-2 text-xs font-semibold text-blue-600">
                      Match Score: {job.score} pts
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Right Side: Detail & Copilot */}
      <div className="w-2/3 bg-gray-50 overflow-y-auto">
        {selectedJob ? (
          <div className="max-w-3xl mx-auto p-12" data-testid="job-details">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-3xl font-bold text-gray-900">{selectedJob.title}</h2>
                  <div className="mt-2 flex items-center text-lg text-gray-600 space-x-3">
                    <span className="font-semibold text-gray-900">{selectedJob.company}</span>
                    <span>&mdash;</span>
                    <span>{selectedJob.location || selectedJob.source || "India / Remote"}</span>
                  </div>
                </div>
                {selectedJob.status && (
                  <span
                    className={`px-3 py-1 text-sm font-bold rounded-full border ${getStatusBadge(
                      selectedJob.status
                    )}`}
                  >
                    {selectedJob.status} ({selectedJob.score ?? 0} pts)
                  </span>
                )}
              </div>

              {selectedJob.url && (
                <div className="mt-4">
                  <a
                    href={selectedJob.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-blue-600 hover:underline"
                  >
                    View Original Listing &rarr;
                  </a>
                </div>
              )}

              <div className="mt-8 pt-8 border-t border-gray-100">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-4">
                  Job Description
                </h3>
                <div className="prose prose-blue max-w-none text-gray-700 whitespace-pre-wrap">
                  {selectedJob.description}
                </div>
              </div>

              <div className="mt-10 pt-6 border-t border-gray-100 flex items-center justify-between">
                <button
                  onClick={() => setShowCopilot(!showCopilot)}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-sm flex items-center space-x-2"
                >
                  <span>{showCopilot ? "Hide Copilot" : "Apply with Copilot"}</span>
                  <span>✨</span>
                </button>
              </div>

              {/* Integrated Copilot Review */}
              {showCopilot && (
                <div className="mt-8 pt-6 border-t border-gray-200">
                  <ApplicationCopilot
                    initialCoverLetter={`Dear Hiring Team at ${selectedJob.company},\n\nI am writing to express my strong interest in the ${selectedJob.title} role. As a B.Tech Computer Science student at VIT Vellore graduating in May 2028 with hands-on experience in distributed systems and backend engineering (including TypeScript, Node.js, Express, PostgreSQL, Prisma, Docker, and Redis), I am eager to contribute.\n\nSincerely,\nShourya Upadhyaya`}
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
  );
}
