"use client";

import React, { useState } from "react";
import { PeopleStrip } from "../networking";
import { ApplicationPatch, PipelineApplication, STAGES, STAGE_META, Stage, formatDate, isStage } from "./types";
import { FitPill, MatchPill, SourceBadge, StageBadge } from "./ui";

type Props = {
  app: PipelineApplication;
  /** Kanban cards are narrower and get previous/next stage buttons. */
  compact?: boolean;
  onPatch: (id: string, patch: ApplicationPatch) => void;
  onDelete: (id: string) => void;
  onPeopleChanged: (companyKey: string) => void;
};

export default function ApplicationCard({ app, compact = false, onPatch, onDelete, onPeopleChanged }: Props) {
  const [editingNotes, setEditingNotes] = useState(false);
  const [draft, setDraft] = useState(app.notes || "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { job } = app;

  const stageIndex = isStage(app.stage) ? STAGES.indexOf(app.stage) : -1;
  const prev: Stage | null = stageIndex > 0 ? STAGES[stageIndex - 1] : null;
  const next: Stage | null = stageIndex >= 0 && stageIndex < STAGES.length - 1 ? STAGES[stageIndex + 1] : null;

  const saveNotes = () => {
    setEditingNotes(false);
    const value = draft.trim() ? draft : null;
    if (value !== (app.notes || null)) onPatch(app.id, { notes: value });
  };

  const applied = formatDate(app.submittedAt);
  const lastEmail = formatDate(app.lastEmailAt);

  return (
    <article
      data-testid={`application-${app.id}`}
      className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3 min-w-0"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <StageBadge stage={app.stage} />
          <MatchPill score={job.score} />
          <FitPill fit={app.fit} />
          <SourceBadge source={app.source} />
        </div>
        {confirmDelete ? (
          <span className="flex items-center gap-1 text-[11px] shrink-0">
            <span className="text-slate-600">Remove?</span>
            <button type="button" onClick={() => onDelete(app.id)} className="px-1.5 py-0.5 rounded bg-rose-600 text-white font-semibold hover:bg-rose-700">
              Remove
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="px-1.5 py-0.5 rounded border border-slate-200 hover:bg-slate-50">
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="text-slate-400 hover:text-rose-600 text-lg leading-none shrink-0"
            title="Remove from pipeline"
            aria-label={`Remove ${job.title} from pipeline`}
          >
            ×
          </button>
        )}
      </header>

      <div className="min-w-0">
        <h3 className="font-bold text-slate-900 text-sm leading-snug break-words">
          {job.url ? (
            <a href={job.url} target="_blank" rel="noopener noreferrer" className="hover:text-indigo-700 hover:underline">
              {job.title}
            </a>
          ) : (
            job.title
          )}
        </h3>
        <p className="text-xs font-medium text-slate-600 mt-0.5 break-words">
          {job.company}
          {job.location ? <span className="text-slate-400"> · {job.location}</span> : null}
        </p>
        <p className="text-[11px] text-slate-500 mt-1 flex flex-wrap gap-x-3">
          {applied ? <span>Applied {applied}</span> : <span>Saved {formatDate(app.createdAt)}</span>}
          {lastEmail && <span>Last email {lastEmail}</span>}
        </p>
        {!job.isActive && (
          <p className="mt-2 px-2 py-1 text-[11px] rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
            Listing looks closed{job.closedReason ? ` (${job.closedReason})` : ""}. Check before spending time on it.
          </p>
        )}
      </div>

      <div className="text-xs">
        {editingNotes ? (
          <div className="space-y-1.5">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Notes"
              autoFocus
              placeholder="Recruiter, interview dates, follow-ups…"
              className="w-full h-20 p-2 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 resize-y text-slate-800"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setDraft(app.notes || "");
                  setEditingNotes(false);
                }}
                className="px-2 py-1 rounded-md text-slate-600 hover:bg-slate-100 font-semibold"
              >
                Cancel
              </button>
              <button type="button" onClick={saveNotes} className="px-2 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 font-semibold">
                Save notes
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(app.notes || "");
              setEditingNotes(true);
            }}
            className="w-full text-left p-2 rounded-lg border border-dashed border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-600 whitespace-pre-wrap break-words"
            title="Edit notes"
          >
            {app.notes || <span className="text-slate-400">+ Add notes</span>}
          </button>
        )}
      </div>

      <div className="pt-2 border-t border-slate-100">
        <PeopleStrip
          company={job.company}
          companyKey={app.companyKey}
          jobListingId={app.jobListingId}
          data={app.people}
          onChanged={() => onPeopleChanged(app.companyKey)}
        />
      </div>

      <footer className="flex items-center gap-2 pt-2 border-t border-slate-100">
        {compact && (
          <button
            type="button"
            disabled={!prev}
            onClick={() => prev && onPatch(app.id, { stage: prev })}
            className="px-2 py-1 text-xs rounded-md border border-slate-200 hover:bg-slate-50 disabled:opacity-30"
            aria-label={prev ? `Move to ${STAGE_META[prev].label}` : "No previous stage"}
            title={prev ? `Move to ${STAGE_META[prev].label}` : undefined}
          >
            ←
          </button>
        )}
        <label className="sr-only" htmlFor={`stage-${app.id}`}>
          Stage
        </label>
        <select
          id={`stage-${app.id}`}
          value={app.stage}
          onChange={(e) => onPatch(app.id, { stage: e.target.value })}
          className="flex-1 min-w-0 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {!isStage(app.stage) && (
            <option value={app.stage} disabled>
              Unknown ({app.stage})
            </option>
          )}
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_META[s].label}
            </option>
          ))}
        </select>
        {compact && (
          <button
            type="button"
            disabled={!next}
            onClick={() => next && onPatch(app.id, { stage: next })}
            className="px-2 py-1 text-xs rounded-md border border-slate-200 hover:bg-slate-50 disabled:opacity-30"
            aria-label={next ? `Move to ${STAGE_META[next].label}` : "No next stage"}
            title={next ? `Move to ${STAGE_META[next].label}` : undefined}
          >
            →
          </button>
        )}
      </footer>
    </article>
  );
}
