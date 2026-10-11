"use client";

import React, { useState, useEffect } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export interface Contact {
  id: string;
  name: string;
  company: string;
  role: string;
  profileUrl: string;
  headline?: string;
  team?: string;
  vitAlumni: boolean;
  outreachAngle?: string;
  relevanceScore: number;
  status: string;
  notes?: string;
  requestSentAt?: string;
  acceptedAt?: string;
  nextFollowUpAt?: string;
  messages: Array<{
    id: string;
    type: string;
    content: string;
    status: string;
  }>;
}

export default function NetworkingCrm() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCompany, setFilterCompany] = useState("");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [vitOnly, setVitOnly] = useState(false);

  // Discovery Modal state
  const [showDiscoveryModal, setShowDiscoveryModal] = useState(false);
  const [discoveryCompany, setDiscoveryCompany] = useState("Cloudflare");
  const [discovering, setDiscovering] = useState(false);

  // Message Copy Modal state
  const [activeMessage, setActiveMessage] = useState<{
    contact: Contact;
    type: string;
    content: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchContacts = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filterCompany) params.append("company", filterCompany);
      if (filterStatus !== "ALL") params.append("status", filterStatus);
      if (vitOnly) params.append("vitAlumni", "true");
      if (search) params.append("search", search);

      const res = await fetch(`${API_BASE_URL}/api/networking/contacts?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setContacts(data);
      }
    } catch (err) {
      console.error("Failed to fetch networking contacts:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContacts();
  }, [filterCompany, filterStatus, vitOnly, search]);

  const handleGenerateTargets = async () => {
    try {
      setDiscovering(true);
      const res = await fetch(`${API_BASE_URL}/api/networking/generate-targets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: discoveryCompany, saveToDb: true }),
      });
      if (res.ok) {
        setShowDiscoveryModal(false);
        fetchContacts();
      }
    } catch (err) {
      console.error("Failed to generate targets:", err);
    } finally {
      setDiscovering(false);
    }
  };

  const handleGenerateNote = async (contact: Contact) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/networking/contacts/${contact.id}/generate-note`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setActiveMessage({
          contact,
          type: "LinkedIn Connection Note (<300 chars)",
          content: data.note.content,
        });
        setCopied(false);
        fetchContacts();
      }
    } catch (err) {
      console.error("Failed to generate note:", err);
    }
  };

  const handleGenerateReferral = async (contact: Contact) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/networking/contacts/${contact.id}/generate-referral`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setActiveMessage({
          contact,
          type: "Personalized Referral Ask",
          content: data.referralMsg.content,
        });
        setCopied(false);
        fetchContacts();
      }
    } catch (err) {
      console.error("Failed to generate referral:", err);
    }
  };

  const handleTransition = async (contactId: string, newStage: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/networking/contacts/${contactId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newStage }),
      });
      if (res.ok) {
        fetchContacts();
      }
    } catch (err) {
      console.error("Failed to transition stage:", err);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // Metrics
  const totalContacts = contacts.length;
  const vitCount = contacts.filter((c) => c.vitAlumni).length;
  const acceptedCount = contacts.filter((c) => c.status === "ACCEPTED").length;
  const requestSentCount = contacts.filter((c) => c.status === "REQUEST_SENT").length;

  return (
    <div className="space-y-6">
      {/* Metrics Banner */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Network Leads</p>
          <p className="text-2xl font-extrabold text-slate-900 mt-1">{totalContacts}</p>
        </div>
        <div className="bg-emerald-50/60 p-4 rounded-xl border border-emerald-200 shadow-xs">
          <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">🎓 VIT Alumni Targets</p>
          <p className="text-2xl font-extrabold text-emerald-800 mt-1">{vitCount}</p>
        </div>
        <div className="bg-blue-50/60 p-4 rounded-xl border border-blue-200 shadow-xs">
          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider">📨 Requests Sent</p>
          <p className="text-2xl font-extrabold text-blue-800 mt-1">{requestSentCount}</p>
        </div>
        <div className="bg-indigo-50/60 p-4 rounded-xl border border-indigo-200 shadow-xs">
          <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wider">🤝 Accepted Connections</p>
          <p className="text-2xl font-extrabold text-indigo-800 mt-1">{acceptedCount}</p>
        </div>
      </div>

      {/* Action Bar & Filters */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search by name, role, company..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-64"
          />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="ALL">All Stages</option>
            <option value="RESEARCHED">Researched</option>
            <option value="REQUEST_SENT">Request Sent</option>
            <option value="ACCEPTED">Accepted</option>
            <option value="REFERRAL_REQUESTED">Referral Requested</option>
            <option value="REFERRED">Referred</option>
          </select>
          <label className="flex items-center space-x-2 text-xs font-semibold text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={vitOnly}
              onChange={(e) => setVitOnly(e.target.checked)}
              className="rounded text-indigo-600 focus:ring-indigo-500"
            />
            <span>🎓 VIT Alumni Only</span>
          </label>
        </div>

        <button
          onClick={() => setShowDiscoveryModal(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center space-x-2"
        >
          <span>🔍</span>
          <span>Auto-Discover Target Leads</span>
        </button>
      </div>

      {/* Contacts List */}
      {loading ? (
        <div className="text-center py-12 text-slate-400">Loading contacts...</div>
      ) : contacts.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <span className="text-4xl">🤝</span>
          <h3 className="text-base font-bold text-slate-800 mt-3">No Networking Contacts Found</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
            Click "Auto-Discover Target Leads" to research VIT alumni and software engineers for your target companies.
          </p>
          <button
            onClick={() => setShowDiscoveryModal(true)}
            className="mt-4 px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700"
          >
            Discover Cloudflare / Linear Leads
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {contacts.map((contact) => (
            <div
              key={contact.id}
              className="bg-white rounded-xl border border-slate-200 shadow-xs hover:border-slate-300 transition-all p-5 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-sm font-extrabold text-slate-900">{contact.name}</h4>
                    <p className="text-xs text-indigo-600 font-semibold">{contact.role}</p>
                    <p className="text-xs text-slate-600 font-medium">🏢 {contact.company}</p>
                  </div>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      contact.vitAlumni
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-slate-50 text-slate-600 border-slate-200"
                    }`}
                  >
                    {contact.relevanceScore}% Fit
                  </span>
                </div>

                {contact.vitAlumni && (
                  <div className="mt-2 inline-flex items-center space-x-1 bg-emerald-100/70 text-emerald-800 px-2 py-0.5 rounded text-[11px] font-bold">
                    <span>🎓</span>
                    <span>VIT Vellore Alumni</span>
                  </div>
                )}

                {contact.headline && (
                  <p className="text-xs text-slate-500 mt-2 line-clamp-2 italic">"{contact.headline}"</p>
                )}

                {contact.outreachAngle && (
                  <div className="mt-3 p-2 bg-slate-50 rounded-lg border border-slate-100 text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-700">Outreach Angle: </span>
                    {contact.outreachAngle}
                  </div>
                )}

                <div className="mt-3 flex items-center space-x-2">
                  <span className="text-[11px] font-semibold text-slate-500">Stage:</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md">
                    {contact.status}
                  </span>
                </div>
              </div>

              {/* Actions Footer */}
              <div className="mt-5 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
                <a
                  href={contact.profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-[11px] font-bold transition-colors"
                >
                  🔗 LinkedIn Profile
                </a>

                {contact.status === "RESEARCHED" && (
                  <>
                    <button
                      onClick={() => handleGenerateNote(contact)}
                      className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-md text-[11px] font-bold transition-colors"
                    >
                      📝 Note (&lt;300 chars)
                    </button>
                    <button
                      onClick={() => handleTransition(contact.id, "REQUEST_SENT")}
                      className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-[11px] font-bold transition-colors"
                    >
                      Mark Sent
                    </button>
                  </>
                )}

                {contact.status === "REQUEST_SENT" && (
                  <button
                    onClick={() => handleTransition(contact.id, "ACCEPTED")}
                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-[11px] font-bold transition-colors"
                  >
                    ✅ Mark Accepted
                  </button>
                )}

                {contact.status === "ACCEPTED" && (
                  <>
                    <button
                      onClick={() => handleGenerateReferral(contact)}
                      className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-[11px] font-bold transition-colors"
                    >
                      📨 Draft Referral Ask
                    </button>
                    <button
                      onClick={() => handleTransition(contact.id, "REFERRED")}
                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-[11px] font-bold transition-colors"
                    >
                      🏆 Mark Referred
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Auto-Discovery Modal */}
      {showDiscoveryModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <h3 className="text-base font-extrabold text-slate-900">Auto-Discover Networking Leads</h3>
            <p className="text-xs text-slate-500 mt-1">
              Job-Agent will generate ranked target personas prioritizing VIT Vellore alumni, backend engineers, and university talent recruiters.
            </p>

            <div className="mt-4">
              <label className="text-xs font-bold text-slate-700">Target Company Name</label>
              <input
                type="text"
                value={discoveryCompany}
                onChange={(e) => setDiscoveryCompany(e.target.value)}
                placeholder="e.g. Cloudflare, Linear, Spotify, Google"
                className="mt-1 w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="mt-6 flex justify-end space-x-2">
              <button
                onClick={() => setShowDiscoveryModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateTargets}
                disabled={discovering}
                className="px-4 py-2 text-xs font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {discovering ? "Researching..." : "Generate 4 Leads"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Message Copy Modal */}
      {activeMessage && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">{activeMessage.type}</h3>
                <p className="text-xs text-slate-500">For {activeMessage.contact.name} ({activeMessage.contact.company})</p>
              </div>
              <span className="text-[11px] font-mono font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                {activeMessage.content.length} chars
              </span>
            </div>

            <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 whitespace-pre-wrap leading-relaxed font-sans">
              {activeMessage.content}
            </div>

            <div className="mt-5 flex items-center justify-between">
              <span className="text-[11px] text-slate-400">
                {activeMessage.content.length <= 300 ? "✓ Within LinkedIn 300-char limit" : ""}
              </span>
              <div className="flex space-x-2">
                <button
                  onClick={() => setActiveMessage(null)}
                  className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Close
                </button>
                <button
                  onClick={() => copyToClipboard(activeMessage.content)}
                  className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-colors text-white ${
                    copied ? "bg-emerald-600" : "bg-indigo-600 hover:bg-indigo-700"
                  }`}
                >
                  {copied ? "✓ Copied to Clipboard!" : "Copy Note"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
