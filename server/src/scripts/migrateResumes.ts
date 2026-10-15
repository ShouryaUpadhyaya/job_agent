/**
 * Moves the single legacy resume into the multi-resume model: when a profile has no Resume
 * rows, creates a default "General" resume from CandidateProfile.rawResume (or, failing that,
 * the latest RESUME Document). Skills = vocabulary skills found in the text plus the
 * profile's existing skills, so match scores don't drop. Rescores all jobs after applying.
 *
 * Dry run (default):  npx tsx src/scripts/migrateResumes.ts
 * Apply:              npx tsx src/scripts/migrateResumes.ts --apply [--no-rescore]
 * Take a pg_dump backup first.
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { prisma } from '../db';
import { normaliseSkills, skillsFromText } from '../resumes/service';

export interface ResumeMigrationPlan {
  profileId: string;
  profileName: string;
  action: 'create' | 'skip';
  reason: string;
  source?: 'rawResume' | 'document';
  content?: string;
  skills?: string[];
}

export async function planResumeMigration(): Promise<ResumeMigrationPlan[]> {
  const profiles = await prisma.candidateProfile.findMany({
    orderBy: { id: 'asc' },
    include: { _count: { select: { resumes: true } } },
  });
  const plans: ResumeMigrationPlan[] = [];
  for (const p of profiles) {
    const base = { profileId: p.id, profileName: p.name };
    if (p._count.resumes > 0) {
      plans.push({ ...base, action: 'skip', reason: `already has ${p._count.resumes} resume(s)` });
      continue;
    }
    let content = p.rawResume?.trim() || '';
    let source: ResumeMigrationPlan['source'] = 'rawResume';
    if (!content) {
      const doc = await prisma.document.findFirst({
        where: { candidateProfileId: p.id, type: 'RESUME' },
        orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
      });
      content = doc?.content?.trim() || '';
      source = 'document';
    }
    if (!content) {
      plans.push({ ...base, action: 'skip', reason: 'no rawResume and no RESUME document to migrate' });
      continue;
    }
    const skills = normaliseSkills([...skillsFromText(content), ...(p.skills || [])]);
    plans.push({ ...base, action: 'create', reason: `from ${source}`, source, content, skills });
  }
  return plans;
}

export async function applyResumeMigration(plans: ResumeMigrationPlan[]): Promise<number> {
  let created = 0;
  for (const plan of plans) {
    if (plan.action !== 'create' || !plan.content) continue;
    await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction so a second run never duplicates.
      if (await tx.resume.count({ where: { candidateProfileId: plan.profileId } })) return;
      await tx.resume.create({
        data: {
          candidateProfileId: plan.profileId,
          label: 'General',
          targetCategory: 'general',
          content: plan.content!,
          skills: plan.skills || [],
          isDefault: true,
        },
      });
      await tx.candidateProfile.update({ where: { id: plan.profileId }, data: { rawResume: plan.content } });
      created++;
    });
  }
  return created;
}

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? 'Mode: APPLY (changes will be written)' : 'Mode: DRY RUN (pass --apply to write changes)');
  const plans = await planResumeMigration();
  if (!plans.length) console.log('No candidate profiles found.');
  for (const p of plans) {
    if (p.action === 'skip') {
      console.log(`  skip    ${p.profileName} (${p.profileId}): ${p.reason}`);
    } else {
      console.log(`  create  ${p.profileName} (${p.profileId}): default "General" resume ${p.reason}, ${p.content!.length} chars`);
      console.log(`          skills: ${p.skills!.join(', ') || '(none)'}`);
    }
  }
  const todo = plans.filter((p) => p.action === 'create').length;
  if (!apply) {
    console.log(`\nDry run: would create ${todo} resume(s).`);
    return;
  }
  const created = await applyResumeMigration(plans);
  console.log(`\nCreated ${created} resume(s).`);
  if (created && !process.argv.includes('--no-rescore')) {
    const { rescoreAllJobs } = await import('../matching/resumeScoring');
    const { rescored } = await rescoreAllJobs();
    console.log(`Rescored ${rescored} active job(s).`);
  }
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
