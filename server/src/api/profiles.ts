import { Router, Request, Response } from 'express';
import multer from 'multer';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { ensureActiveProfile, getActiveProfile, getProfileResumes } from '../lib/profile';
import { extractTextFromPdf, parseResumeText } from '../resumes/parser';
import { createResume, normaliseSkills, profileFillFromResume } from '../resumes/service';
import { rescoreWithBudget } from '../resumes/rescore';

export const profilesRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

class ValidationError extends Error {}

const STRING_FIELDS = {
  email: 200, phone: 40, location: 120, school: 160, targetRole: 200,
  githubUrl: 300, linkedinUrl: 300, portfolioUrl: 300, xUrl: 300,
} as const;

function optionalString(v: unknown, max: number, field: string): string | null {
  if (v === null) return null;
  if (typeof v !== 'string') throw new ValidationError(`${field} must be a string`);
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function stringList(v: unknown, field: string): string[] {
  if (!Array.isArray(v)) throw new ValidationError(`${field} must be an array`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const t = item.trim().slice(0, 120);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

function jsonValue(v: unknown, field: string, shape: 'object' | 'array'): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (v === null) return Prisma.DbNull;
  const ok = shape === 'array' ? Array.isArray(v) : !!v && typeof v === 'object' && !Array.isArray(v);
  if (!ok) throw new ValidationError(`${field} must be ${shape === 'array' ? 'an array' : 'an object'}`);
  if (JSON.stringify(v).length > 100_000) throw new ValidationError(`${field} is too large`);
  return v as Prisma.InputJsonValue;
}

/**
 * Builds a partial update from the request body: only fields that are present are touched,
 * so saving the form never wipes rawResume or Wellfound-only answers.
 */
function profileUpdateFromBody(body: Record<string, any>, existingAnswers: unknown): Prisma.CandidateProfileUpdateInput {
  const data: Prisma.CandidateProfileUpdateInput = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) throw new ValidationError('Name is required');
    data.name = body.name.trim().slice(0, 120);
  }
  for (const [field, max] of Object.entries(STRING_FIELDS)) {
    if (body[field] !== undefined) (data as any)[field] = optionalString(body[field], max, field);
  }
  if (body.targetGradYear !== undefined) {
    if (body.targetGradYear === null || body.targetGradYear === '') data.targetGradYear = null;
    else {
      const year = Number(body.targetGradYear);
      if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new ValidationError('targetGradYear must be a year');
      data.targetGradYear = year;
    }
  }
  if (body.skills !== undefined) {
    if (!Array.isArray(body.skills)) throw new ValidationError('skills must be an array');
    data.skills = normaliseSkills(body.skills);
  }
  if (body.preferredLocations !== undefined) data.preferredLocations = stringList(body.preferredLocations, 'preferredLocations');
  if (body.remoteOk !== undefined) {
    if (typeof body.remoteOk !== 'boolean') throw new ValidationError('remoteOk must be true or false');
    data.remoteOk = body.remoteOk;
  }
  if (body.education !== undefined) data.education = jsonValue(body.education, 'education', 'object');
  if (body.experience !== undefined) data.experience = jsonValue(body.experience, 'experience', 'array');
  if (body.rawResume !== undefined) data.rawResume = body.rawResume === null ? null : String(body.rawResume);
  if (body.applicationAnswers !== undefined) {
    const patch = body.applicationAnswers;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new ValidationError('applicationAnswers must be an object');
    // Shallow merge: keys sent as null are removed, everything else (e.g. wellfoundRules) is kept.
    const merged: Record<string, unknown> =
      existingAnswers && typeof existingAnswers === 'object' && !Array.isArray(existingAnswers) ? { ...(existingAnswers as object) } : {};
    for (const [key, value] of Object.entries(patch)) {
      if (key.length > 60) continue;
      if (value === null) delete merged[key];
      else merged[key] = typeof value === 'string' ? value.slice(0, 2000) : value;
    }
    data.applicationAnswers = merged as Prisma.InputJsonValue;
  }
  return data;
}

// GET /api/profiles - the active candidate profile with its resumes and recent documents
profilesRouter.get('/profiles', async (_req: Request, res: Response) => {
  try {
    const profile = await ensureActiveProfile();
    const [resumes, documents] = await Promise.all([
      getProfileResumes(profile.id),
      prisma.document.findMany({
        where: { candidateProfileId: profile.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, type: true, version: true, createdAt: true, jobApplicationId: true },
      }),
    ]);
    res.json({
      ...profile,
      resumes: resumes.map((r) => ({ id: r.id, label: r.label, targetCategory: r.targetCategory, isDefault: r.isDefault, skills: r.skills })),
      documents,
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function saveProfile(req: Request, res: Response, requireName: boolean) {
  const body = (req.body || {}) as Record<string, any>;
  if (requireName && (typeof body.name !== 'string' || !body.name.trim())) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    const target = body.id
      ? await prisma.candidateProfile.findUnique({ where: { id: String(body.id) } })
      : await getActiveProfile();
    const data = profileUpdateFromBody(body, target?.applicationAnswers);

    const profile = target
      ? await prisma.candidateProfile.update({ where: { id: target.id }, data })
      : await prisma.candidateProfile.create({
          data: { ...(data as Prisma.CandidateProfileCreateInput), ...(body.id ? { id: String(body.id) } : {}), name: (data.name as string) || 'Your Name' },
        });

    await prisma.auditLog.create({
      data: {
        action: 'CANDIDATE_PROFILE_UPDATED',
        entityId: profile.id,
        metadata: { fields: Object.keys(data), skillsCount: profile.skills.length },
      },
    });

    const rescore = await rescoreWithBudget('profile saved');
    return res.status(200).json({ ...profile, rescore });
  } catch (error) {
    if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
    console.error('Error creating/updating profile:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /api/profiles - create or update the profile (name required; other fields only if present)
profilesRouter.post('/profiles', (req, res) => saveProfile(req, res, true));

// PATCH /api/profiles - partial update of the active profile
profilesRouter.patch('/profiles', (req, res) => saveProfile(req, res, false));

// POST /api/profiles/upload-resume - legacy single-resume upload; now adds a Resume
// (default when it is the first), fills empty profile fields and stores a versioned Document.
profilesRouter.post('/profiles/upload-resume', upload.single('resume'), async (req: Request, res: Response) => {
  try {
    let rawText = '';
    if (req.file) {
      const isPdf = req.file.mimetype === 'application/pdf' || /\.pdf$/i.test(req.file.originalname);
      rawText = isPdf ? await extractTextFromPdf(req.file.buffer) : req.file.buffer.toString('utf-8');
    } else if (req.body?.rawText) {
      rawText = String(req.body.rawText);
    } else {
      return res.status(400).json({ error: 'Please upload a PDF file or provide rawText' });
    }
    rawText = rawText.trim();
    if (!rawText) return res.status(400).json({ error: 'Resume content was empty or unparseable' });

    const parsed = parseResumeText(rawText);
    let profile = await ensureActiveProfile();
    const existingResumes = await prisma.resume.count({ where: { candidateProfileId: profile.id } });
    const resume = await createResume({
      profileId: profile.id,
      label: existingResumes === 0 ? 'General' : `Resume ${existingResumes + 1}`,
      content: rawText,
      fileName: req.file?.originalname?.slice(0, 200) ?? null,
      skills: parsed.skills,
    });

    const { data, filled } = profileFillFromResume(profile, parsed);
    if (filled.length) profile = await prisma.candidateProfile.update({ where: { id: profile.id }, data });

    const latest = await prisma.document.findFirst({
      where: { candidateProfileId: profile.id, type: 'RESUME' },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const doc = await prisma.document.create({
      data: { type: 'RESUME', version: (latest?.version ?? 0) + 1, content: rawText, candidateProfileId: profile.id },
    });

    const rescore = await rescoreWithBudget('resume uploaded');
    await prisma.auditLog.create({
      data: {
        action: 'RESUME_PARSED_AND_SYNCED',
        entityId: profile.id,
        metadata: { extractedSkills: parsed.skills, resumeId: resume.id, filledProfileFields: filled },
      },
    });

    res.status(200).json({
      success: true,
      profile: await prisma.candidateProfile.findUnique({ where: { id: profile.id } }),
      resume,
      documentId: doc.id,
      parsedSummary: {
        name: parsed.name,
        email: parsed.email,
        skillsFound: parsed.skills.length,
        skills: parsed.skills,
        graduationYear: parsed.education?.graduationYear,
      },
      filledProfileFields: filled,
      rescoredCount: rescore.status === 'done' ? rescore.rescored ?? 0 : null,
      rescore,
    });
  } catch (err) {
    console.error('Error parsing resume:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to process resume' });
  }
});
