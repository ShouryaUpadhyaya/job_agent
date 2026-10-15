"use client";

import React from "react";
import { deepLinkElementId } from "@/lib/urlParams";
import { Job, freshnessText, freshnessTone, splitReasons, statusTone } from "./types";

type Props = {
  job: Job;
  selected: boolean;
  onSelect: (job: Job) => void;
  onUserStatus: (job: Job, status: "NONE" | "SAVED" | "DISMISSED") => void;
};

export default function JobCard({ job, selected, onSelect, onUserStatus }: Props) {
  const { why, skip } = splitReasons(job.matchReasons);
  const saved = job.userStatus === "SAVED";
  const dismissed = job.userStatus === "DISMISSED";

  return (
    <li id={deepLinkElementId("job", job.id)} className={`border-l-4 ${selected ? "bg-blue-50 border-blue-600" : "border-transparent hover:bg-slate-50"} ${dismissed ? "opacity-60" : ""}`}>
      <div className="p-4">
        <button onClick={() => onSelect(job)} className="w-full text-left focus:outline-none" data-testid={`job-item-${job.id}`}>
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-sm text-gray-900 leading-snug">{job.title}</h3>
            <span className={`shrink-0 px-2 py-0.5 text-[10px] font-bold rounded-full border ${statusTone(job.status)}`}>
              {job.score}
            </span>
          </div>
          <div className="mt-1 text-xs text-gray-500">
            <span className="font-medium text-gray-700">{job.company}</span>
            {job.location && <span> · {job.location}</span>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border ${freshnessTone(job)}`}>{freshnessText(job)}</span>
            {job.appliedStage && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded border bg-indigo-50 text-indigo-700 border-indigo-200">
                {["APPLIED", "INTERVIEWING", "OFFERED", "REJECTED"].includes(job.appliedStage) ? "✓ Applied" : "In pipeline"} · {job.appliedStage}
              </span>
            )}
            {saved && <span className="px-1.5 py-0.5 text-[10px] font-bold rounded border bg-yellow-50 text-yellow-800 border-yellow-200">Saved</span>}
            {job.verified === false && job.verificationLabel && (
              <span className="px-1.5 py-0.5 text-[10px] rounded border bg-slate-50 text-slate-500 border-slate-200" title="Not confirmed live by Job Agent">
                {job.verificationLabel}
              </span>
            )}
            <span className="px-1.5 py-0.5 text-[10px] rounded border bg-white text-slate-500 border-slate-200">{job.sourceLabel || job.source}</span>
          </div>
          {(why.length > 0 || skip.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-1" aria-label="Why matched">
              {why.slice(0, 4).map((r) => (
                <span key={r} className="px-1.5 py-0.5 text-[10px] rounded-full bg-blue-50 text-blue-800">{r}</span>
              ))}
              {skip.slice(0, 1).map((r) => (
                <span key={r} className="px-1.5 py-0.5 text-[10px] rounded-full bg-rose-50 text-rose-700">{r}</span>
              ))}
            </div>
          )}
          {job.bestResumeLabel && <p className="mt-1 text-[10px] text-slate-500">Best resume: {job.bestResumeLabel}</p>}
        </button>
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => onUserStatus(job, saved ? "NONE" : "SAVED")}
            className="text-[11px] font-semibold text-slate-600 hover:text-yellow-700"
            aria-label={saved ? `Unsave ${job.title}` : `Save ${job.title}`}
          >
            {saved ? "★ Saved" : "☆ Save"}
          </button>
          <button
            onClick={() => onUserStatus(job, dismissed ? "NONE" : "DISMISSED")}
            className="text-[11px] font-semibold text-slate-600 hover:text-rose-700"
            aria-label={dismissed ? `Restore ${job.title}` : `Dismiss ${job.title}`}
          >
            {dismissed ? "Restore" : "Dismiss"}
          </button>
          <a href={job.url} target="_blank" rel="noopener noreferrer" className="ml-auto text-[11px] font-semibold text-blue-600 hover:underline">
            Open ↗
          </a>
        </div>
      </div>
    </li>
  );
}
