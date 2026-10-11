"use client";

import React, { useState, useEffect } from "react";

export type Application = {
  id: string;
  jobListingId: string;
  stage: string;
  status: string;
  isApproved: boolean;
  notes?: string;
  appliedUrl?: string;
  submittedAt?: string;
  createdAt: string;
  jobListing?: {
    title: string;
    company: string;
    url: string;
    location?: string;
  };
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const STAGES = [
  { key: "BOOKMARKED", label: "Saved / Ready", badge: "bg-blue-50 text-blue-700 border-blue-200" },
  { key: "APPLYING", label: "In Prep", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  { key: "APPLIED", label: "Applied", badge: "bg-purple-50 text-purple-700 border-purple-200" },
  { key: "INTERVIEWING", label: "Interviewing", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { key: "OFFERED", label: "Offered", badge: "bg-green-100 text-green-800 border-green-300" },
  { key: "REJECTED", label: "Rejected / Closed", badge: "bg-gray-100 text-gray-600 border-gray-200" },
];

export default function ApplicationsPipeline() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [editingNotes, setEditingNotes] = useState("");

  const fetchApplications = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE_URL}/api/applications`);
      if (!res.ok) throw new Error("Failed to fetch applications");
      const data = await res.json();
      setApplications(data);
    } catch (err: any) {
      setError(err.message || "Failed to load applications");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApplications();
  }, []);

  const handleUpdateStage = async (id: string, newStage: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: newStage }),
      });
      if (res.ok) {
        await fetchApplications();
      }
    } catch (err) {
      console.error("Error updating stage:", err);
    }
  };

  const handleSaveNotes = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: editingNotes }),
      });
      if (res.ok) {
        setSelectedApp(null);
        await fetchApplications();
      }
    } catch (err) {
      console.error("Error saving notes:", err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to remove this tracked application?")) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/applications/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        if (selectedApp?.id === id) setSelectedApp(null);
        await fetchApplications();
      }
    } catch (err) {
      console.error("Error deleting application:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Application Pipeline Tracker</h2>
          <p className="text-sm text-slate-500 mt-1">
            Track your internship submissions across stages with complete audit history and human-in-the-loop oversight.
          </p>
        </div>
        <button
          onClick={fetchApplications}
          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-sm transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-sm">
          {error}
        </div>
      )}

      {applications.length === 0 ? (
        <div className="bg-white p-12 text-center rounded-2xl border border-slate-100 shadow-sm">
          <div className="text-4xl mb-3">📋</div>
          <h3 className="text-lg font-bold text-slate-800">No Applications Tracked Yet</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto mt-2">
            Switch to the Job Feed tab, select an internship match, and click &ldquo;Bookmark to Pipeline&rdquo; or &ldquo;Prepare Application&rdquo;.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {applications.map((app) => {
            const stageConfig = STAGES.find((s) => s.key === app.stage) || STAGES[0];
            return (
              <div
                key={app.id}
                className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start gap-2 mb-3">
                    <span
                      className={`px-3 py-1 text-xs font-bold rounded-full border ${stageConfig.badge}`}
                    >
                      {stageConfig.label}
                    </span>
                    <button
                      onClick={() => handleDelete(app.id)}
                      className="text-slate-400 hover:text-rose-600 text-sm"
                      title="Remove from pipeline"
                    >
                      ×
                    </button>
                  </div>

                  <h3 className="font-bold text-slate-900 text-base leading-snug">
                    {app.jobListing?.title || "Role Title"}
                  </h3>
                  <p className="text-sm font-medium text-slate-600 mt-1">
                    {app.jobListing?.company || "Company"} • {app.jobListing?.location || "Location"}
                  </p>

                  {app.jobListing?.url && (
                    <a
                      href={app.jobListing.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-xs font-semibold text-indigo-600 hover:text-indigo-800 mt-2"
                    >
                      View Job Listing ↗
                    </a>
                  )}

                  {app.notes && (
                    <div className="mt-3 p-3 bg-slate-50 rounded-xl text-xs text-slate-600 border border-slate-100">
                      <strong>Notes:</strong> {app.notes}
                    </div>
                  )}
                </div>

                <div className="mt-6 pt-4 border-t border-slate-100 space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Move Stage:</label>
                    <select
                      value={app.stage}
                      onChange={(e) => handleUpdateStage(app.id, e.target.value)}
                      className="w-full text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg p-2 text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {STAGES.map((st) => (
                        <option key={st.key} value={st.key}>
                          {st.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={() => {
                      setSelectedApp(app);
                      setEditingNotes(app.notes || "");
                    }}
                    className="w-full py-1.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors text-center"
                  >
                    ✏ Edit Notes
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedApp && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex justify-center items-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100">
            <h3 className="text-lg font-bold text-slate-900 mb-2">Edit Application Notes</h3>
            <p className="text-xs text-slate-500 mb-4">
              {selectedApp.jobListing?.title} at {selectedApp.jobListing?.company}
            </p>

            <textarea
              value={editingNotes}
              onChange={(e) => setEditingNotes(e.target.value)}
              placeholder="Add recruiter contact, interview questions, or follow-up dates..."
              className="w-full h-32 p-3 text-sm bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 resize-none text-slate-800"
            />

            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => setSelectedApp(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSaveNotes(selectedApp.id)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm shadow-md"
              >
                Save Notes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
