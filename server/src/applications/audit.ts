/**
 * Audit trail for application stage changes and creations. Every writer of `JobApplication.stage`
 * (manual UI edits, Gmail effects, the Wellfound CSV import) records the same shapes so the
 * briefing's movement and stale sections see every change:
 *
 *  - JOB_APPLICATION_CREATED: { jobListingId, stage, source }
 *  - JOB_APPLICATION_UPDATED: { changes: { stage, ... }, from: { stage }, source }
 */
import { prisma } from '../db';
import type { StageChangeSource } from '../lib/stages';

export async function recordApplicationCreated(input: {
  applicationId: string;
  jobListingId: string;
  stage: string;
  source: StageChangeSource;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action: 'JOB_APPLICATION_CREATED',
      entityId: input.applicationId,
      metadata: { jobListingId: input.jobListingId, stage: input.stage, source: input.source },
    },
  });
}

/**
 * Records an update. `changes` are the fields written (dates are serialised); `fromStage` is the
 * stage before the write.
 */
export async function recordApplicationUpdate(input: {
  applicationId: string;
  changes: Record<string, unknown>;
  fromStage: string;
  source: StageChangeSource;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action: 'JOB_APPLICATION_UPDATED',
      entityId: input.applicationId,
      metadata: JSON.parse(
        JSON.stringify({ changes: input.changes, from: { stage: input.fromStage }, source: input.source })
      ),
    },
  });
}

/** Shorthand for a pure stage change. */
export function recordStageChange(applicationId: string, from: string, to: string, source: StageChangeSource): Promise<void> {
  return recordApplicationUpdate({ applicationId, changes: { stage: to }, fromStage: from, source });
}
