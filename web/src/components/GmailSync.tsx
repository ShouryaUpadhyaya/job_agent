"use client";

import React, { useState, useEffect } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export interface EmailEvent {
  id: string;
  messageId: string;
  sender: string;
  senderName?: string;
  subject: string;
  snippet?: string;
  receivedAt: string;
  classification: string;
  confidence: number;
  explanation?: string;
  suggestedAction?: string;
  company?: string;
  jobApplication?: {
    id: string;
    stage: string;
    jobListing: { title: string; company: string };
  };
  networkingContact?: {
    id: string;
    name: string;
    company: string;
  };
}

export interface GmailStatus {
  connected: boolean;
  email: string | null;
  lastSyncedAt: string | null;
  totalEventsTracked: number;
  hasCredentialsConfigured: boolean;
}

export default function GmailSync() {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [events, setEvents] = useState<EmailEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filterClassification, setFilterClassification] = useState("ALL");

  // Simulation form state
  const [simSender, setSimSender] = useState("recruiting@cloudflare.com");
  const [simSubject, setSimSubject] = useState("Invitation to Interview: Software Engineer Intern");
  const [simSnippet, setSimSnippet] = useState("We would love to schedule a 45-minute technical screen with our Systems team.");
  const [simulating, setSimulating] = useState(false);

  const fetchStatusAndEvents = async () => {
    try {
      setLoading(true);
      const [statusRes, eventsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/gmail/status`),
        fetch(`${API_BASE_URL}/api/gmail/events`),
      ]);

      if (statusRes.ok) {
        setStatus(await statusRes.json());
      }
      if (eventsRes.ok) {
        setEvents(await eventsRes.json());
      }
    } catch (err) {
      console.error("Failed to fetch Gmail data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatusAndEvents();
  }, []);

  const handleConnectGmail = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/gmail/auth-url`);
      if (res.ok) {
        const data = await res.json();
        window.location.href = data.url;
      }
    } catch (err) {
      console.error("Failed to get Google OAuth URL:", err);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Are you sure you want to disconnect your Gmail account?")) return;
    try {
      await fetch(`${API_BASE_URL}/api/gmail/disconnect`, { method: "POST" });
      fetchStatusAndEvents();
    } catch (err) {
      console.error("Failed to disconnect:", err);
    }
  };

  const handleSyncNow = async () => {
    try {
      setSyncing(true);
      const res = await fetch(`${API_BASE_URL}/api/gmail/sync`, { method: "POST" });
      if (res.ok) {
        await fetchStatusAndEvents();
      }
    } catch (err) {
      console.error("Failed to sync Gmail:", err);
    } finally {
      setSyncing(false);
    }
  };

  const handleSimulateEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSimulating(true);
      const res = await fetch(`${API_BASE_URL}/api/gmail/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: simSender,
          subject: simSubject,
          snippet: simSnippet,
        }),
      });

      if (res.ok) {
        await fetchStatusAndEvents();
      }
    } catch (err) {
      console.error("Failed to simulate email:", err);
    } finally {
      setSimulating(false);
    }
  };

  const getBadgeColor = (classification: string) => {
    switch (classification) {
      case "INTERVIEW_INVITATION":
        return "bg-purple-100 text-purple-800 border-purple-200";
      case "OFFER":
        return "bg-emerald-100 text-emerald-800 border-emerald-200";
      case "ASSESSMENT":
        return "bg-amber-100 text-amber-800 border-amber-200";
      case "LINKEDIN_CONNECTION_ACCEPTED":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "APPLICATION_CONFIRMATION":
        return "bg-sky-100 text-sky-800 border-sky-200";
      case "REJECTION":
        return "bg-rose-100 text-rose-800 border-rose-200";
      default:
        return "bg-slate-100 text-slate-700 border-slate-200";
    }
  };

  const filteredEvents = events.filter((ev) => {
    if (filterClassification === "ALL") return true;
    return ev.classification === filterClassification;
  });

  return (
    <div className="space-y-6">
      {/* Account Status Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center text-2xl border border-red-100">
            ✉️
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-base font-extrabold text-slate-900">Gmail Mailbox Integration</h3>
              <span
                className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                  status?.connected
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-slate-100 text-slate-600 border-slate-200"
                }`}
              >
                {status?.connected ? "● Connected" : "○ Not Connected"}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {status?.connected
                ? `Synchronized with ${status.email}`
                : "Connect your Google account to automatically classify interview invites, assessments, and accepted connection alerts."}
            </p>
            {status?.lastSyncedAt && (
              <p className="text-[11px] text-slate-400 mt-1">
                Last checked: {new Date(status.lastSyncedAt).toLocaleString()}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {status?.connected ? (
            <>
              <button
                onClick={handleSyncNow}
                disabled={syncing}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors disabled:opacity-50"
              >
                {syncing ? "Checking Mailbox..." : "🔄 Sync Inbox Now"}
              </button>
              <button
                onClick={handleDisconnect}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors"
              >
                Disconnect
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleConnectGmail}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center space-x-2"
              >
                <span>🔑</span>
                <span>Connect with Google OAuth</span>
              </button>
              <button
                onClick={handleSyncNow}
                disabled={syncing}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
              >
                {syncing ? "Simulating..." : "🧪 Load Demo Events"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Simulator Section */}
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">
              🧪 Live Email Classifier & Correlation Tester
            </h4>
            <p className="text-xs text-slate-500">
              Simulate an incoming email to test auto-classification, pipeline stage updating, and Networking CRM response generation.
            </p>
          </div>
        </div>

        <form onSubmit={handleSimulateEmail} className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            type="text"
            placeholder="Sender (e.g. recruiting@cloudflare.com)"
            value={simSender}
            onChange={(e) => setSimSender(e.target.value)}
            className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            required
          />
          <input
            type="text"
            placeholder="Subject line"
            value={simSubject}
            onChange={(e) => setSimSubject(e.target.value)}
            className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            required
          />
          <div className="flex space-x-2">
            <input
              type="text"
              placeholder="Snippet text"
              value={simSnippet}
              onChange={(e) => setSimSnippet(e.target.value)}
              className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={simulating}
              className="px-4 py-1.5 bg-slate-900 hover:bg-black text-white text-xs font-bold rounded-lg transition-colors shrink-0 disabled:opacity-50"
            >
              {simulating ? "Processing..." : "Simulate"}
            </button>
          </div>
        </form>

        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
          <span className="font-semibold">Quick test presets:</span>
          <button
            type="button"
            onClick={() => {
              setSimSender("recruiting@cloudflare.com");
              setSimSubject("Invitation to Interview: Software Engineer Intern at Cloudflare");
              setSimSnippet("We would love to schedule a technical screen with our Systems team.");
            }}
            className="text-indigo-600 hover:underline"
          >
            Interview Invitation
          </button>
          <span>•</span>
          <button
            type="button"
            onClick={() => {
              setSimSender("invitations@linkedin.com");
              setSimSubject("Priya Sharma accepted your invitation to connect");
              setSimSnippet("Priya Sharma is now a connection on LinkedIn.");
            }}
            className="text-indigo-600 hover:underline"
          >
            LinkedIn Accepted
          </button>
          <span>•</span>
          <button
            type="button"
            onClick={() => {
              setSimSender("talent@spotify.com");
              setSimSubject("Spotify Engineering: HackerRank Coding Challenge");
              setSimSnippet("Please complete the online assessment within 5 calendar days.");
            }}
            className="text-indigo-600 hover:underline"
          >
            HackerRank Assessment
          </button>
        </div>
      </div>

      {/* Events Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-slate-900">
            Classified Email Events ({filteredEvents.length})
          </h3>
          <select
            value={filterClassification}
            onChange={(e) => setFilterClassification(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white"
          >
            <option value="ALL">All Classifications</option>
            <option value="INTERVIEW_INVITATION">Interview Invitations</option>
            <option value="ASSESSMENT">Assessments / Coding Challenges</option>
            <option value="LINKEDIN_CONNECTION_ACCEPTED">LinkedIn Connections Accepted</option>
            <option value="APPLICATION_CONFIRMATION">Application Confirmations</option>
            <option value="OFFER">Offers</option>
            <option value="REJECTION">Rejections</option>
          </select>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-400 text-xs">Loading email events...</div>
        ) : filteredEvents.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            No classified email events found. Click "Load Demo Events" or "Simulate" above.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredEvents.map((ev) => (
              <div key={ev.id} className="p-4 hover:bg-slate-50/60 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <span
                        className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${getBadgeColor(
                          ev.classification
                        )}`}
                      >
                        {ev.classification.replace(/_/g, " ")}
                      </span>
                      {ev.company && (
                        <span className="text-xs font-bold text-slate-800">🏢 {ev.company}</span>
                      )}
                      <span className="text-[11px] text-slate-400">
                        {new Date(ev.receivedAt).toLocaleString()}
                      </span>
                    </div>

                    <h4 className="text-xs font-bold text-slate-900 mt-1">{ev.subject}</h4>
                    <p className="text-xs text-slate-600 mt-0.5">{ev.snippet}</p>

                    {ev.suggestedAction && (
                      <div className="mt-2 inline-flex items-center space-x-1.5 text-[11px] bg-slate-100 text-slate-700 px-2.5 py-1 rounded-md">
                        <span className="font-semibold text-slate-900">Suggested Action:</span>
                        <span>{ev.suggestedAction}</span>
                      </div>
                    )}

                    {ev.jobApplication && (
                      <div className="mt-2 text-[11px] text-indigo-700 font-semibold">
                        🔗 Linked Application: {ev.jobApplication.jobListing.title} (Stage: {ev.jobApplication.stage})
                      </div>
                    )}

                    {ev.networkingContact && (
                      <div className="mt-2 text-[11px] text-emerald-700 font-semibold">
                        🤝 Linked Contact: {ev.networkingContact.name} ({ev.networkingContact.company})
                      </div>
                    )}
                  </div>

                  <span className="text-[10px] text-slate-400 font-mono">
                    {Math.round(ev.confidence * 100)}% conf
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
