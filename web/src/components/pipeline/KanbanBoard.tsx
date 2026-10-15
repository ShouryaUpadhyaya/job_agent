"use client";

import React from "react";
import ApplicationCard from "./ApplicationCard";
import { ApplicationPatch, PipelineApplication, STAGES, STAGE_META, Stage, isStage } from "./types";

type Props = {
  applications: PipelineApplication[];
  /** Stages to show as columns (all when empty). */
  stages: Stage[];
  onPatch: (id: string, patch: ApplicationPatch) => void;
  onDelete: (id: string) => void;
  onPeopleChanged: (companyKey: string) => void;
};

/** One column per stage, in the server's sort order within each column. */
export default function KanbanBoard({ applications, stages, onPatch, onDelete, onPeopleChanged }: Props) {
  const columns: { key: string; label: string; tone: string; items: PipelineApplication[] }[] = (stages.length ? stages : [...STAGES]).map(
    (s) => ({ key: s, label: STAGE_META[s].label, tone: STAGE_META[s].column, items: applications.filter((a) => a.stage === s) })
  );
  const unknown = applications.filter((a) => !isStage(a.stage));
  if (unknown.length) columns.push({ key: "OTHER", label: "Unknown stage", tone: "border-t-slate-200", items: unknown });

  return (
    <div className="overflow-x-auto pb-2" data-testid="kanban-board">
      <div className="flex gap-4 items-start min-w-max">
        {columns.map((col) => (
          <section key={col.key} aria-label={`${col.label} column`} className={`w-72 shrink-0 bg-slate-50 rounded-2xl border border-slate-200 border-t-4 ${col.tone}`}>
            <h3 className="px-3 py-2 text-xs font-bold text-slate-700 flex justify-between">
              <span>{col.label}</span>
              <span className="text-slate-400">{col.items.length}</span>
            </h3>
            <div className="px-2 pb-2 space-y-2">
              {col.items.length === 0 ? (
                <p className="text-[11px] text-slate-400 text-center py-4">Nothing here</p>
              ) : (
                col.items.map((app) => (
                  <ApplicationCard key={app.id} app={app} compact onPatch={onPatch} onDelete={onDelete} onPeopleChanged={onPeopleChanged} />
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
