"use client";

import React, { useEffect, useState } from "react";
import ApplicationCopilot from "../ApplicationCopilot";
import { api, errorMessage } from "@/lib/api";
import { Job, Profile, freshnessText, freshnessTone, splitReasons, statusTone } from "./types";

type Tailored = { content: string; matchedSkills: string[]; missingKeywords: string[]; bullets: string[] };

type Props = {
  job: Job;
  profile: Profile | null;
  onUserStatus: (job: Job, status: "NONE" | "SAVED" | "DISMISSED") => void;
  onPipelineChanged: () => void;
};

/** Starting point for the copilot, built from the profile (edit or regenerate it there). */
export function draftCoverLetter(job: Job, profile: Profile | null): string {
  const name = profile?.name || "";
  const school = profile?.school ? ` at ${profile.school}` : "";
  const grad = profile?.targetGradYear ? ` (graduating ${profile.targetGradYear})` : "";
  const skills = (job.matchedSkills?.length ? job.matchedSkills : profile?.skills || []).slice(0, 5).join(", ");
  return [
    `Dear Hiring Team at ${job.company},`,
    "",
    `I am writing to express my interest in the ${job.title} position. I am a student${school}${grad}${skills ? ` with hands-on experience in ${skills}` : ""}, and I would be glad to contribute to your team.`,
    "",
    "Thank you for considering my application.",
    "",
    "Sincerely,",
    name,
  ].join("\n");
}

export default function JobDetail({ job, profile, onUserStatus, onPipelineChanged }: Props) {
  const [full, setFull] = useState<Job>(job);
  const [message, setMessage] = useState<string | null>(null);
  const [tailoring, setTailoring] = useState(false);
  const [tailored, setTailored] = useState<Tailored | null>(null);
  const [showCopilot, setShowCopilot] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!job.descriptionTruncated) return;
    api<Job>(`/api/jobs/${job.id}`)
      .then((data) => {
        if (!cancelled) setFull((prev) => ({ ...prev, ...data }));
      })
      .catch(() => {
        // Keep the truncated description from the list.
      });
    return () => {
      cancelled = true;
    };
  }, [job.id, job.descriptionTruncated]);

  const current = { ...full, userStatus: job.userStatus, appliedStage: job.appliedStage };
  const { why, skip, check } = splitReasons(current.matchReasons);

  const addToPipeline = async () => {
    try {
      setMessage(null);
      const res = await api<{ duplicate?: boolean }>("/api/applications", {
        body: { jobListingId: job.id, stage: "BOOKMARKED", notes: `Added from Job Discovery (${job.score} pts)` },
      });
      setMessage(
        res?.duplicate
          ? `"${job.title}" is already in your Application Pipeline.`
          : `✓ "${job.title}" added to the Application Pipeline.`
      );
      onPipelineChanged();
    } catch (err) {
      setMessage(`✗ ${errorMessage(err)}`);
    }
  };

  const tailorResume = async () => {
    try {
      setTailoring(true);
      setTailored(null);
      setTailored(await api<Tailored>("/api/copilot/tailor-resume", { body: { jobListingId: job.id } }));
    } catch (err) {
      setMessage(`✗ ${errorMessage(err)}`);
    } finally {
      setTailoring(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-8" data-testid="job-details">
      <div className="bg-white rounded-2xl shadow-xs border border-gray-200 p-7">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-5">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 leading-tight">{current.title}</h2>
            <div className="mt-2 text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{current.company}</span>
              {current.location && <span> — {current.location}</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              <span className={`px-2 py-0.5 rounded border font-semibold ${freshnessTone(current)}`}>{freshnessText(current)}</span>
              {current.verificationLabel && (
                <span className={`px-2 py-0.5 rounded border ${current.verified ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-500 border-slate-200"}`}>
                  {current.verificationLabel}
                </span>
              )}
              <span className="px-2 py-0.5 rounded border bg-white text-slate-500 border-slate-200">{current.sourceLabel || current.source}</span>
              {current.appliedStage && (
                <span className="px-2 py-0.5 rounded border bg-indigo-50 text-indigo-700 border-indigo-200 font-bold">Pipeline: {current.appliedStage}</span>
              )}
            </div>
          </div>
          <span className={`shrink-0 px-3 py-1 text-sm font-bold rounded-full border ${statusTone(current.status)}`}>
            {current.status} · {current.score}
          </span>
        </div>

        {message && <div className="mt-4 p-3 bg-indigo-50 border border-indigo-200 text-indigo-800 rounded-xl text-xs font-semibold">{message}</div>}

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <a href={current.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 hover:underline">
            Open job posting ↗
          </a>
          {current.attribution && (
            <a href={current.attribution.url} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-500 hover:underline">
              {current.attribution.label}
            </a>
          )}
        </div>

        <div className="mt-5 p-4 rounded-xl bg-blue-50/60 border border-blue-100 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-blue-900">Why this matched</h3>
          {why.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {why.map((r) => (
                <span key={r} className="px-2 py-0.5 text-xs rounded-full bg-white border border-blue-200 text-blue-900">{r}</span>
              ))}
            </div>
          )}
          {skip.map((r) => (
            <p key={r} className="text-xs text-rose-700 font-semibold">✗ {r}</p>
          ))}
          {check.map((r) => (
            <p key={r} className="text-xs text-amber-700">⚠ {r}</p>
          ))}
          {current.matchedSkills && current.matchedSkills.length > 0 && (
            <div className="flex flex-wrap gap-1 items-center">
              <span className="text-xs font-semibold text-gray-700 mr-1">Matched:</span>
              {current.matchedSkills.map((s) => (
                <span key={s} className="px-2 py-0.5 text-xs font-medium rounded-md bg-emerald-100 text-emerald-800">✓ {s}</span>
              ))}
            </div>
          )}
          {current.missingSkills && current.missingSkills.length > 0 && (
            <div className="flex flex-wrap gap-1 items-center">
              <span className="text-xs font-semibold text-gray-700 mr-1">In the JD, not on your resume:</span>
              {current.missingSkills.map((s) => (
                <span key={s} className="px-2 py-0.5 text-xs font-medium rounded-md bg-amber-100 text-amber-800">{s}</span>
              ))}
            </div>
          )}
          {current.bestResumeLabel && <p className="text-xs text-slate-600">Best resume for this job: <strong>{current.bestResumeLabel}</strong></p>}
        </div>

        <div className="mt-6 pt-5 border-t border-gray-100">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Job description</h3>
          <div className="text-sm max-w-none text-gray-700 whitespace-pre-wrap leading-relaxed">{current.description}</div>
        </div>

        <div className="mt-7 pt-5 border-t border-gray-100 flex flex-wrap items-center gap-2">
          <button onClick={addToPipeline} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-sm font-semibold">
            📌 Add to pipeline
          </button>
          <button
            onClick={() => onUserStatus(job, job.userStatus === "SAVED" ? "NONE" : "SAVED")}
            className="px-4 py-2 bg-yellow-50 hover:bg-yellow-100 text-yellow-800 rounded-xl text-sm font-semibold"
          >
            {job.userStatus === "SAVED" ? "★ Saved" : "☆ Save"}
          </button>
          <button
            onClick={() => onUserStatus(job, job.userStatus === "DISMISSED" ? "NONE" : "DISMISSED")}
            className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-sm font-semibold"
          >
            {job.userStatus === "DISMISSED" ? "Restore" : "Dismiss"}
          </button>
          <button
            onClick={tailorResume}
            disabled={tailoring}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
          >
            {tailoring ? "Analyzing…" : "🎯 Tailor resume"}
          </button>
          <button onClick={() => setShowCopilot(!showCopilot)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold">
            {showCopilot ? "Hide copilot" : "Apply with copilot ✨"}
          </button>
        </div>

        {tailored && (
          <div className="mt-6 p-5 rounded-2xl bg-emerald-50/60 border border-emerald-200 space-y-3">
            <h4 className="font-bold text-emerald-900 text-sm">🎯 Tailored resume suggestions</h4>
            {tailored.missingKeywords.length > 0 && (
              <p className="text-xs text-slate-700">
                <span className="font-bold text-emerald-800">Keywords to emphasize: </span>
                {tailored.missingKeywords.join(", ")}
              </p>
            )}
            <ul className="text-xs text-slate-800 space-y-1 list-disc list-inside">
              {tailored.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-bold text-emerald-800">Markdown</span>
                <button
                  onClick={() => navigator.clipboard?.writeText(tailored.content)}
                  className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900"
                >
                  📋 Copy
                </button>
              </div>
              <pre className="p-3 bg-white rounded-xl border border-emerald-200 text-xs font-mono overflow-x-auto text-slate-700 max-h-48 whitespace-pre-wrap">
                {tailored.content}
              </pre>
            </div>
          </div>
        )}

        {showCopilot && (
          <div className="mt-8 pt-6 border-t border-gray-200">
            <ApplicationCopilot key={job.id} initialCoverLetter={draftCoverLetter(current, profile)} />
          </div>
        )}
      </div>
    </div>
  );
}
