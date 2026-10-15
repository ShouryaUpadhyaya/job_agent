import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { getActiveProfile, getProfileResumes } from '../lib/profile';
import { matchJob, MatchJobInput, MatchOptions, MatchProfile, MatchResult } from './engine';
import { extractSkills } from './skills';

export interface ResumeLike {
  id: string;
  label?: string | null;
  skills: string[];
  content?: string | null;
}

export interface ResumeMatch {
  best: MatchResult;
  bestResumeId: string | null;
  /** resumeId → score; null when the profile has no resumes. */
  scoresByResume: Record<string, number> | null;
}

/** A resume's effective skills: its explicit list plus vocabulary skills found in its text. */
export function resumeSkills(resume: ResumeLike): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...(resume.skills || []), ...extractSkills(resume.content || '')]) {
    const key = s.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s.trim());
  }
  return out;
}

/**
 * Scores a job against every resume of the profile and keeps the best one. Without resumes,
 * the profile's own skills are used.
 */
export function scoreJobAcrossResumes(
  profile: MatchProfile,
  resumes: ResumeLike[],
  job: MatchJobInput,
  options: MatchOptions = {}
): ResumeMatch {
  if (!resumes.length) {
    return { best: matchJob(profile, job, options), bestResumeId: null, scoresByResume: null };
  }
  let best: MatchResult | null = null;
  let bestResumeId: string | null = null;
  const scoresByResume: Record<string, number> = {};
  for (const resume of resumes) {
    const skills = resumeSkills(resume);
    const result = matchJob({ ...profile, skills: skills.length ? skills : profile.skills }, job, options);
    scoresByResume[resume.id] = result.score;
    if (!best || result.score > best.score) {
      best = result;
      bestResumeId = resume.id;
    }
  }
  return { best: best!, bestResumeId, scoresByResume };
}

/**
 * matchReasons column: positive reasons as-is, then disqualifications prefixed "SKIP: " and
 * concerns prefixed "CHECK: " so the UI can render them differently.
 */
export function flattenReasons(result: MatchResult): string[] {
  return [
    ...result.reasons,
    ...result.disqualifications.map((d) => `SKIP: ${d}`),
    ...result.eligibilityConcerns.map((c) => `CHECK: ${c}`),
  ];
}

/** Prisma update payload for a match. */
export function matchUpdateData(match: ResumeMatch) {
  return {
    score: match.best.score,
    status: match.best.classification,
    matchReasons: flattenReasons(match.best),
    matchedSkills: match.best.matchedSkills,
    missingSkills: match.best.missingSkills,
    bestResumeId: match.bestResumeId,
    scoresByResume: match.scoresByResume ?? Prisma.DbNull,
  };
}

let rescoreRunning: Promise<{ rescored: number }> | null = null;

/**
 * Rescores every active job against the active profile and its resumes, in batches.
 * Called after each sync; the profile/resume API should call it after edits.
 * Concurrent calls share one run.
 */
export function rescoreAllJobs(options: { batchSize?: number; includeInactive?: boolean } = {}): Promise<{ rescored: number }> {
  if (rescoreRunning) return rescoreRunning;
  rescoreRunning = (async () => {
    const profile = await getActiveProfile();
    if (!profile) return { rescored: 0 };
    const resumes = await getProfileResumes(profile.id);
    const batchSize = options.batchSize ?? 200;
    let cursor: string | undefined;
    let rescored = 0;

    for (;;) {
      const jobs = await prisma.jobListing.findMany({
        where: options.includeInactive ? {} : { isActive: true },
        orderBy: { id: 'asc' },
        take: batchSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: {
          id: true, title: true, description: true, company: true, location: true,
          publishedAt: true, createdAt: true, employmentType: true,
        },
      });
      if (!jobs.length) break;
      await prisma.$transaction(
        jobs.map((job) =>
          prisma.jobListing.update({
            where: { id: job.id },
            data: matchUpdateData(scoreJobAcrossResumes(profile, resumes, job)),
          })
        )
      );
      rescored += jobs.length;
      cursor = jobs[jobs.length - 1].id;
      if (jobs.length < batchSize) break;
    }
    return { rescored };
  })().finally(() => {
    rescoreRunning = null;
  });
  return rescoreRunning;
}
