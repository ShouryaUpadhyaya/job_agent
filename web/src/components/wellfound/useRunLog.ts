"use client";

import { useEffect, useRef, useState } from "react";
import { api, buildUrl } from "@/lib/api";
import { WellfoundRun } from "./types";

const MAX_LINES = 5000;

export interface RunLogState {
  lines: string[];
  run: WellfoundRun | null;
  ended: boolean;
  transport: "sse" | "polling" | "idle";
  error: string | null;
}

/**
 * Follows a run's log: EventSource on /runs/:id/stream (replay + live tail), falling back to
 * polling /runs/:id/log when SSE is unavailable or drops. Lines stay after the run ends.
 * Remount (key={runId}) to switch runs.
 */
export function useRunLog(runId: string | null, onEnd?: (run: WellfoundRun | null) => void): RunLogState {
  const [state, setState] = useState<RunLogState>({ lines: [], run: null, ended: false, transport: "idle", error: null });
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let offset = 0;
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const append = (lines: string[]) =>
      setState((s) => ({ ...s, lines: [...s.lines, ...lines].slice(-MAX_LINES) }));
    let ended = false;
    const finish = (run: WellfoundRun | null) => {
      if (cancelled || ended) return;
      ended = true;
      setState((s) => ({ ...s, run: run || s.run, ended: true }));
      onEndRef.current?.(run);
    };

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await api<{ lines: string[]; nextOffset: number; done: boolean; run: WellfoundRun }>(
          `/api/wellfound/runs/${runId}/log`,
          { query: { offset } }
        );
        if (cancelled) return;
        offset = res.nextOffset;
        if (res.lines.length) append(res.lines);
        setState((s) => ({ ...s, run: res.run, transport: "polling", error: null }));
        if (res.done) return finish(res.run);
      } catch (err) {
        if (cancelled) return;
        setState((s) => ({ ...s, transport: "polling", error: err instanceof Error ? err.message : String(err) }));
      }
      pollTimer = setTimeout(poll, 1500);
    };

    if (typeof EventSource === "undefined") {
      void poll();
    } else {
      es = new EventSource(buildUrl(`/api/wellfound/runs/${runId}/stream`, { offset: 0 }));
      setTimeout(() => !cancelled && setState((s) => (s.transport === "idle" ? { ...s, transport: "sse" } : s)), 0);
      es.addEventListener("log", (e) => {
        const data = JSON.parse((e as MessageEvent).data) as { lines: string[]; offset: number };
        offset = data.offset;
        append(data.lines);
      });
      es.addEventListener("run", (e) => {
        const run = JSON.parse((e as MessageEvent).data) as WellfoundRun;
        setState((s) => ({ ...s, run }));
      });
      es.addEventListener("end", (e) => {
        es?.close();
        finish(JSON.parse((e as MessageEvent).data) as WellfoundRun | null);
      });
      es.onerror = () => {
        // SSE dropped (proxy, server restart): continue from the last offset by polling
        es?.close();
        es = null;
        if (!cancelled && !ended) void poll();
      };
    }

    return () => {
      cancelled = true;
      es?.close();
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [runId]);

  return state;
}
