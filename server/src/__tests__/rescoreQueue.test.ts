import { describe, it, expect, vi, afterEach } from 'vitest';
import { prisma } from '../db';
import { rescoreAllJobs } from '../matching/resumeScoring';

describe('rescoreAllJobs concurrency', () => {
  afterEach(() => vi.restoreAllMocks());

  it('queues exactly one follow-up run for calls made during a run', async () => {
    const spy = vi.spyOn(prisma.candidateProfile, 'findFirst');

    const first = rescoreAllJobs();
    const second = rescoreAllJobs();
    const third = rescoreAllJobs();
    expect(third).toBe(second);
    await Promise.all([first, second, third]);

    // One run for the first call plus one queued rerun shared by the others.
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('runs once when there is no concurrency', async () => {
    const spy = vi.spyOn(prisma.candidateProfile, 'findFirst');
    await rescoreAllJobs();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
