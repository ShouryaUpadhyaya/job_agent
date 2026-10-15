import { rescoreAllJobs } from '../matching/resumeScoring';

/**
 * Rescoring after profile/resume edits. Requests made while a run is in progress queue one
 * more pass so the latest edits are always scored. API routes wait a short budget so small
 * databases (and tests) finish synchronously; larger ones continue in the background and the
 * UI polls the status.
 */

export interface RescoreStatus {
  running: boolean;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastRescored: number | null;
  lastError: string | null;
  lastReason: string | null;
}

const state: RescoreStatus = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastRescored: null,
  lastError: null,
  lastReason: null,
};

let current: Promise<void> | null = null;
let rerun = false;

export function getRescoreStatus(): RescoreStatus {
  return { ...state };
}

/** Starts (or queues) a full rescore; resolves when the latest requested pass has finished. Never rejects. */
export function requestRescore(reason: string): Promise<RescoreStatus> {
  state.lastReason = reason;
  if (current) {
    rerun = true;
    return current.then(getRescoreStatus);
  }
  current = (async () => {
    do {
      rerun = false;
      state.running = true;
      state.lastStartedAt = new Date().toISOString();
      try {
        const { rescored } = await rescoreAllJobs();
        state.lastRescored = rescored;
        state.lastError = null;
      } catch (err) {
        state.lastError = err instanceof Error ? err.message : String(err);
        console.error('Rescore failed:', err);
      }
      state.lastFinishedAt = new Date().toISOString();
    } while (rerun);
    state.running = false;
  })().finally(() => {
    current = null;
  });
  return current.then(getRescoreStatus);
}

export type RescoreOutcome =
  | { status: 'done'; rescored: number | null; error: string | null }
  | { status: 'running' };

/** Requests a rescore and waits up to `budgetMs` for it. */
export async function rescoreWithBudget(reason: string, budgetMs = Number(process.env.RESCORE_WAIT_MS) || 5000): Promise<RescoreOutcome> {
  const run = requestRescore(reason);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), budgetMs);
  });
  const result = await Promise.race([run, timeout]);
  clearTimeout(timer);
  if (!result) return { status: 'running' };
  return { status: 'done', rescored: result.lastRescored, error: result.lastError };
}
