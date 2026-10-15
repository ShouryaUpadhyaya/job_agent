/**
 * Application stage model. Automated sources (Wellfound CSV, Gmail) may only move an
 * application forward; they never undo a terminal outcome or regress a stage the user set.
 * Manual edits from the UI can set any stage.
 */

export const STAGES = ['BOOKMARKED', 'APPLYING', 'APPLIED', 'INTERVIEWING', 'OFFERED', 'REJECTED', 'ARCHIVED'] as const;
export type Stage = (typeof STAGES)[number];

/** Progress order for forward-only automated updates. Terminal stages share the top rank. */
const RANK: Record<Stage, number> = {
  BOOKMARKED: 0,
  APPLYING: 1,
  APPLIED: 2,
  INTERVIEWING: 3,
  OFFERED: 4,
  REJECTED: 4,
  ARCHIVED: 5,
};

const TERMINAL: Stage[] = ['OFFERED', 'REJECTED', 'ARCHIVED'];

export type StageChangeSource = 'manual' | 'wellfound' | 'email' | 'import';

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value);
}

export function canTransition(from: string | null | undefined, to: string, source: StageChangeSource): boolean {
  if (!isStage(to)) return false;
  if (source === 'manual') return true;
  if (!from || !isStage(from)) return true;
  if (from === to) return false;
  if (TERMINAL.includes(from)) return false;
  return RANK[to] > RANK[from];
}

/** Keeps the legacy `status` column consistent with `stage`. */
export function statusForStage(stage: Stage): string {
  switch (stage) {
    case 'BOOKMARKED':
    case 'APPLYING':
      return 'DRAFT';
    case 'APPLIED':
      return 'SUBMITTED';
    default:
      return stage;
  }
}
