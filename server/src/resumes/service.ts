import { CandidateProfile, Prisma, Resume } from '@prisma/client';
import { prisma } from '../db';
import { canonicalSkillName, extractSkills } from '../matching/skills';
import { ParsedResume } from './parser';

/** Trimmed, de-duplicated (case-insensitive) skills; vocabulary skills get their canonical name. */
export function normaliseSkills(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!trimmed) continue;
    const name = canonicalSkillName(trimmed);
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Skills found in resume text via the matching vocabulary (word-boundary, alias aware). */
export function skillsFromText(content: string): string[] {
  return extractSkills(content);
}

/** Keeps CandidateProfile.rawResume equal to the default resume (Gemini + Wellfound read it). */
export async function syncProfileRawResume(profileId: string, tx: Prisma.TransactionClient = prisma) {
  const def = await tx.resume.findFirst({ where: { candidateProfileId: profileId, isDefault: true } });
  if (def) await tx.candidateProfile.update({ where: { id: profileId }, data: { rawResume: def.content } });
}

export interface CreateResumeInput {
  profileId: string;
  label: string;
  content: string;
  targetCategory?: string | null;
  fileName?: string | null;
  skills?: string[];
  isDefault?: boolean;
}

export async function createResume(input: CreateResumeInput): Promise<Resume> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.resume.count({ where: { candidateProfileId: input.profileId } });
    const makeDefault = existing === 0 || input.isDefault === true;
    if (makeDefault) {
      await tx.resume.updateMany({ where: { candidateProfileId: input.profileId, isDefault: true }, data: { isDefault: false } });
    }
    const resume = await tx.resume.create({
      data: {
        candidateProfileId: input.profileId,
        label: input.label,
        targetCategory: input.targetCategory || null,
        content: input.content,
        fileName: input.fileName || null,
        skills: input.skills ?? skillsFromText(input.content),
        isDefault: makeDefault,
      },
    });
    if (makeDefault) await syncProfileRawResume(input.profileId, tx);
    return resume;
  });
}

export async function setDefaultResume(profileId: string, resumeId: string): Promise<Resume> {
  return prisma.$transaction(async (tx) => {
    await tx.resume.updateMany({ where: { candidateProfileId: profileId, isDefault: true, NOT: { id: resumeId } }, data: { isDefault: false } });
    const resume = await tx.resume.update({ where: { id: resumeId }, data: { isDefault: true } });
    await syncProfileRawResume(profileId, tx);
    return resume;
  });
}

export class ResumeRuleError extends Error {}

/** Deletes a resume; the oldest remaining one becomes default if needed. The last resume can't be deleted. */
export async function deleteResume(profileId: string, resumeId: string): Promise<{ newDefaultId: string | null }> {
  return prisma.$transaction(async (tx) => {
    const resumes = await tx.resume.findMany({ where: { candidateProfileId: profileId }, orderBy: { createdAt: 'asc' } });
    const target = resumes.find((r) => r.id === resumeId);
    if (!target) throw new ResumeRuleError('Resume not found');
    if (resumes.length === 1) throw new ResumeRuleError('You need at least one resume. Upload another before deleting this one.');
    await tx.jobListing.updateMany({ where: { bestResumeId: resumeId }, data: { bestResumeId: null } });
    await tx.resume.delete({ where: { id: resumeId } });
    let newDefaultId: string | null = null;
    if (target.isDefault) {
      const next = resumes.find((r) => r.id !== resumeId)!;
      await tx.resume.update({ where: { id: next.id }, data: { isDefault: true } });
      await syncProfileRawResume(profileId, tx);
      newDefaultId = next.id;
    }
    return { newDefaultId };
  });
}

/** The resume to ground generated text in for a job: the job's best resume, else the default. */
export async function resumeForJob(profileId: string, bestResumeId?: string | null): Promise<Resume | null> {
  if (bestResumeId) {
    const best = await prisma.resume.findFirst({ where: { id: bestResumeId, candidateProfileId: profileId } });
    if (best) return best;
  }
  return prisma.resume.findFirst({
    where: { candidateProfileId: profileId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
}

const PLACEHOLDER_NAME = /^(your name|candidate|test candidate|default candidate)$/i;
const PLACEHOLDER_EMAIL = /@example\.(com|org)$/i;

function blank(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
}

/**
 * Profile fields that are empty (or placeholders) and that the parsed resume can fill.
 * Never overwrites something the user entered.
 */
export function profileFillFromResume(profile: CandidateProfile, parsed: ParsedResume): { data: Prisma.CandidateProfileUpdateInput; filled: string[] } {
  const data: Record<string, unknown> = {};
  const set = (field: keyof CandidateProfile, value: unknown, isBlank = blank(profile[field])) => {
    if (isBlank && !blank(value)) data[field] = value;
  };
  set('name', parsed.name !== 'Candidate' ? parsed.name : null, blank(profile.name) || PLACEHOLDER_NAME.test(profile.name.trim()));
  set('email', parsed.email, blank(profile.email) || PLACEHOLDER_EMAIL.test(profile.email || ''));
  set('phone', parsed.phone);
  set('githubUrl', parsed.linkMap.github);
  set('linkedinUrl', parsed.linkMap.linkedin);
  set('portfolioUrl', parsed.linkMap.portfolio);
  set('xUrl', parsed.linkMap.x);
  set('school', parsed.education?.institution);
  const edu = parsed.education;
  if (edu && (edu.institution || edu.degree) && (blank(profile.education) || isEmptyObject(profile.education))) {
    data.education = { ...edu } as Prisma.InputJsonValue;
  }
  if (parsed.experience?.length && blank(profile.experience)) {
    data.experience = parsed.experience as unknown as Prisma.InputJsonValue;
  }
  if (!profile.skills?.length && parsed.skills.length) data.skills = parsed.skills;
  return { data: data as Prisma.CandidateProfileUpdateInput, filled: Object.keys(data) };
}

function isEmptyObject(v: unknown): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v as object).every((x) => blank(x));
}
