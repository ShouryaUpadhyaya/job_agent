"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { GenerateResponse, JobOption, MESSAGE_LABELS, MessageType, NetworkingMessage } from "./types";
import { CopyButton, Modal } from "./ui";

type Props = {
  contact: { id: string; name: string; company: string };
  type: MessageType;
  /** Job to reference (e.g. the Pipeline card's job). */
  jobListingId?: string | null;
  /** Open an existing draft instead of generating a new one. */
  existing?: NetworkingMessage | null;
  onClose: () => void;
  /** Called after anything that changes the contact (draft saved, marked sent). */
  onChanged?: () => void;
};

type Draft = Extract<GenerateResponse, { needsJobLink: false }>;

const CHAR_LIMIT = 300;
const WORD_LIMIT = 120;
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

/**
 * Generates (or opens) one draft for a contact, lets the user edit, copy, regenerate and mark
 * it sent. Referral asks need a job: when none is linked, the user picks one here.
 */
export default function MessageDraftModal({ contact, type, jobListingId, existing, onClose, onChanged }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<NetworkingMessage | null>(existing ?? null);
  const [content, setContent] = useState(existing?.content ?? "");
  const [needsJob, setNeedsJob] = useState<{ reason: string; jobOptions: JobOption[] } | null>(null);
  const [jobId, setJobId] = useState<string>(jobListingId || "");
  const [update, setUpdate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const started = useRef(false);

  const generate = useCallback(
    async (useJobId?: string) => {
      try {
        setLoading(true);
        setError(null);
        setNotice(null);
        const res = await api<GenerateResponse>(`/api/networking/contacts/${contact.id}/messages/generate`, {
          body: { type, jobListingId: useJobId || undefined, update: update || undefined },
        });
        if (res.needsJobLink) {
          setNeedsJob({ reason: res.reason, jobOptions: res.jobOptions });
          setJobId((cur) => cur || res.jobOptions[0]?.id || "");
          return;
        }
        setNeedsJob(null);
        setDraft(res);
        setMessage(res.message);
        setContent(res.content);
        onChanged?.();
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [contact.id, type, update, onChanged]
  );

  useEffect(() => {
    if (started.current || existing) return;
    started.current = true;
    void generate(jobListingId || undefined);
  }, [existing, generate, jobListingId]);

  const save = async () => {
    if (!message) return;
    try {
      const saved = await api<NetworkingMessage>(`/api/networking/messages/${message.id}`, { method: "PATCH", body: { content } });
      setMessage(saved);
      setNotice("Draft saved.");
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const markSent = async () => {
    if (!message) return;
    try {
      if (content !== message.content) {
        await api(`/api/networking/messages/${message.id}`, { method: "PATCH", body: { content } });
      }
      const res = await api<{ message: NetworkingMessage }>(`/api/networking/messages/${message.id}/mark-sent`, { method: "POST" });
      setMessage(res.message);
      setNotice("Marked as sent. Status and follow-up date updated.");
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const sent = message?.status === "SENT";
  const overChars = type === "CONNECTION_NOTE" && content.length > CHAR_LIMIT;
  const overWords = type === "REFERRAL_ASK" && words(content) > WORD_LIMIT;

  return (
    <Modal title={`${MESSAGE_LABELS[type]} for ${contact.name}`} onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">{contact.company}</p>

        {needsJob && (
          <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 text-xs text-amber-900 space-y-2">
            <p>{needsJob.reason}</p>
            {needsJob.jobOptions.length ? (
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="Job to reference" value={jobId} onChange={(e) => setJobId(e.target.value)} className="px-2 py-1 border border-amber-300 rounded-md bg-white">
                  {needsJob.jobOptions.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title}
                      {j.applicationStage ? ` (${j.applicationStage.toLowerCase()})` : ""}
                    </option>
                  ))}
                </select>
                <button type="button" disabled={!jobId || loading} onClick={() => generate(jobId)} className="px-2 py-1 rounded-md bg-amber-600 text-white font-semibold">
                  Link job and draft
                </button>
              </div>
            ) : (
              <p>No jobs at {contact.company} are saved yet. Add the posting in Job Discovery (or the Pipeline) first, then come back.</p>
            )}
          </div>
        )}

        {type === "FOLLOW_UP" && !sent && (
          <label className="block text-xs">
            <span className="font-semibold text-slate-700">Anything new since your last message? (optional)</span>
            <input
              value={update}
              onChange={(e) => setUpdate(e.target.value)}
              placeholder="e.g. cleared the online assessment"
              className="mt-1 w-full px-3 py-1.5 border border-slate-300 rounded-lg"
            />
          </label>
        )}

        {loading && <p className="text-xs text-slate-500">Drafting…</p>}
        {error && <p className="text-xs text-rose-600">{error}</p>}
        {draft?.warnings.map((w) => (
          <p key={w} className="text-xs text-amber-700">
            {w}
          </p>
        ))}

        {message && (
          <>
            <textarea
              aria-label="Message text"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              readOnly={sent}
              rows={type === "CONNECTION_NOTE" ? 4 : 10}
              className="w-full p-3 text-sm border border-slate-300 rounded-xl font-sans leading-relaxed"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
              <span className={overChars || overWords ? "text-rose-600 font-semibold" : ""}>
                {type === "CONNECTION_NOTE" ? `${content.trim().length}/${CHAR_LIMIT} characters` : `${words(content)} words${type === "REFERRAL_ASK" ? ` (max ${WORD_LIMIT})` : ""}`}
                {draft ? (draft.usedAi ? " · written with Gemini, check it" : " · template from your profile") : ""}
              </span>
              {draft?.job && (
                <a href={draft.job.url} target="_blank" rel="noopener noreferrer" className="underline">
                  {draft.job.title}
                </a>
              )}
            </div>
            {notice && <p className="text-xs text-emerald-700">{notice}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <CopyButton text={content} label="Copy" className="!px-3 !py-1.5 !text-xs" />
              {!sent && (
                <>
                  <button type="button" disabled={loading} onClick={() => generate(jobId || undefined)} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 hover:bg-slate-50">
                    Regenerate
                  </button>
                  <button type="button" onClick={save} disabled={content === message.content} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50">
                    Save edits
                  </button>
                  <button type="button" onClick={markSent} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
                    I sent it
                  </button>
                </>
              )}
              {sent && <span className="text-xs font-semibold text-emerald-700">Sent</span>}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
