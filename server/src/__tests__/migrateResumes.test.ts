import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '../db';
import { applyResumeMigration, planResumeMigration } from '../scripts/migrateResumes';

async function reset() {
  await prisma.jobApplication.deleteMany({});
  await prisma.document.deleteMany({});
  await prisma.resume.deleteMany({});
  await prisma.candidateProfile.deleteMany({});
}

describe('migrateResumes script', () => {
  beforeEach(reset);
  afterAll(reset);

  it('plans a default resume from rawResume and applies it once', async () => {
    const p = await prisma.candidateProfile.create({ data: { name: 'Kim', skills: ['Rust'], rawResume: 'Built APIs in Node.js and PostgreSQL.' } });
    const plans = await planResumeMigration();
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ action: 'create', source: 'rawResume' });
    expect(plans[0].skills).toEqual(expect.arrayContaining(['Node.js', 'PostgreSQL', 'Rust']));
    expect(await prisma.resume.count()).toBe(0); // planning writes nothing

    expect(await applyResumeMigration(plans)).toBe(1);
    expect(await applyResumeMigration(plans)).toBe(0);
    const resumes = await prisma.resume.findMany({ where: { candidateProfileId: p.id } });
    expect(resumes).toHaveLength(1);
    expect(resumes[0]).toMatchObject({ label: 'General', isDefault: true });

    expect((await planResumeMigration())[0].action).toBe('skip');
  });

  it('falls back to the latest RESUME document, and skips profiles with nothing to migrate', async () => {
    const p = await prisma.candidateProfile.create({ data: { name: 'Lee', skills: [] } });
    await prisma.document.create({ data: { type: 'RESUME', version: 1, content: 'old', candidateProfileId: p.id } });
    await prisma.document.create({ data: { type: 'RESUME', version: 2, content: 'new with Docker', candidateProfileId: p.id } });
    let plans = await planResumeMigration();
    expect(plans[0]).toMatchObject({ action: 'create', source: 'document', content: 'new with Docker' });

    await reset();
    await prisma.candidateProfile.create({ data: { name: 'Empty', skills: [] } });
    plans = await planResumeMigration();
    expect(plans[0].action).toBe('skip');
  });
});
