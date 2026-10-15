"use client";

import React, { useState } from "react";
import { api, errorMessage } from "@/lib/api";

type CopilotJob = { id: string; title: string; company: string; url?: string };

type Props = {
  job: CopilotJob;
  initialCoverLetter?: string;
  onApplied?: () => void;
};

/**
 * Helps prepare an application the user submits themselves on the employer's site:
 * draft/regenerate the cover letter, copy it, open the posting, then record it as applied.
 * It never submits anything to the employer.
 */
export default function ApplicationCopilot({ job, initialCoverLetter = "", onApplied }: Props) {
  const [coverLetter, setCoverLetter] = useState(initialCoverLetter);
  const [question, setQuestion] = useState("");
  const [generating, setGenerating] = useState(false);
  const [marking, setMarking] = useState(false);
  const [applied, setApplied] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const generate = async () => {
    setGenerating(true);
    setNotice(null);
    try {
      const res = await api<{ body?: string; content?: string }>("/api/copilot/tailor-cover-letter", {
        body: { jobListingId: job.id, question: question.trim() || undefined },
      });
      setCoverLetter(res.body || res.content || "");
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
    } finally {
      setGenerating(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(coverLetter);
      setNotice({ tone: "ok", text: "Cover letter copied." });
    } catch {
      setNotice({ tone: "error", text: "Couldn't copy automatically — select the text and copy it." });
    }
  };

  const markApplied = async () => {
    setMarking(true);
    setNotice(null);
    try {
      const res = await api<{ id: string; duplicate?: boolean; stage?: string }>("/api/applications", {
        body: { jobListingId: job.id, stage: "APPLIED", notes: "Applied manually after preparing with the copilot" },
      });
      if (res.duplicate && res.stage !== "APPLIED") {
        await api(`/api/applications/${res.id}`, { method: "PATCH", body: { stage: "APPLIED" } });
      }
      setApplied(true);
      setNotice({ tone: "ok", text: "Recorded as applied in your Application Pipeline." });
      onApplied?.();
    } catch (err) {
      setNotice({ tone: "error", text: errorMessage(err) });
    } finally {
      setMarking(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 bg-white shadow-xl rounded-2xl border border-gray-100">
      <h2 className="text-2xl font-bold text-gray-800 mb-1">Prepare application</h2>
      <p className="text-sm text-gray-500 mb-6">
        Draft your cover letter here, then apply on {job.company}&apos;s site yourself. Nothing is sent from this page.
      </p>

      <div className="mb-4">
        <label htmlFor="copilot-question" className="block text-sm font-semibold text-gray-700 mb-2">
          Application question (optional)
        </label>
        <input
          id="copilot-question"
          className="w-full p-3 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none text-gray-700"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Why do you want to work here?"
        />
      </div>

      <div className="mb-4">
        <label htmlFor="copilot-letter" className="block text-sm font-semibold text-gray-700 mb-2">
          Cover letter
        </label>
        <textarea
          id="copilot-letter"
          className="w-full h-56 p-4 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none resize-y text-gray-700"
          value={coverLetter}
          onChange={(e) => setCoverLetter(e.target.value)}
          placeholder="Your cover letter draft..."
        />
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={generate}
          disabled={generating}
          className="px-4 py-2 bg-gray-800 text-white font-medium rounded-lg hover:bg-gray-700 disabled:opacity-60"
        >
          {generating ? "Generating…" : "Generate from my resume"}
        </button>
        <button
          onClick={copy}
          disabled={!coverLetter}
          className="px-4 py-2 bg-slate-100 text-slate-800 font-medium rounded-lg hover:bg-slate-200 disabled:opacity-60"
        >
          Copy
        </button>
        {job.url && (
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-slate-100 text-slate-800 font-medium rounded-lg hover:bg-slate-200"
          >
            Open posting ↗
          </a>
        )}
      </div>

      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={`mb-4 text-sm ${notice.tone === "error" ? "text-rose-700" : "text-emerald-700"}`}
        >
          {notice.text}
        </p>
      )}

      <div className="pt-6 border-t border-gray-100">
        <button
          onClick={markApplied}
          disabled={marking || applied}
          className={`w-full py-3 px-4 rounded-xl font-bold text-lg transition-all ${
            applied ? "bg-emerald-100 text-emerald-800" : "bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
          }`}
        >
          {applied ? "Marked as applied" : marking ? "Saving…" : "I've applied — mark as applied"}
        </button>
      </div>
    </div>
  );
}
