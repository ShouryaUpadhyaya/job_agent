import { Router, Request, Response } from 'express';
import multer from 'multer';
import { prisma } from '../db';
import { ensureActiveProfile, getProfileResumes } from '../lib/profile';
import { extractTextFromPdf, parseResumeText } from '../resumes/parser';
import {
  createResume,
  deleteResume,
  normaliseSkills,
  profileFillFromResume,
  ResumeRuleError,
  setDefaultResume,
  skillsFromText,
} from '../resumes/service';
import { getRescoreStatus, rescoreWithBudget } from '../resumes/rescore';

export const resumesRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const MAX_CONTENT = 100_000;

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  return v.trim().slice(0, max);
}

/** Multipart fields arrive as strings; skills may be a JSON array or a comma list. */
function skillsInput(v: unknown): string[] | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (Array.isArray(v)) return normaliseSkills(v);
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return normaliseSkills(parsed);
    } catch {
      /* comma list */
    }
    return normaliseSkills(v.split(','));
  }
  return undefined;
}

async function bestForCounts(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const groups = await prisma.jobListing.groupBy({
    by: ['bestResumeId'],
    where: { isActive: true, bestResumeId: { in: ids } },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.bestResumeId as string, g._count._all]));
}

async function listResumes() {
  const profile = await ensureActiveProfile();
  const resumes = await getProfileResumes(profile.id);
  const counts = await bestForCounts(resumes.map((r) => r.id));
  return {
    profileId: profile.id,
    resumes: resumes.map((r) => ({ ...r, bestForCount: counts.get(r.id) ?? 0 })),
    rescore: getRescoreStatus(),
  };
}

async function ownResume(id: string) {
  const profile = await ensureActiveProfile();
  const resume = await prisma.resume.findFirst({ where: { id, candidateProfileId: profile.id } });
  return { profile, resume };
}

// GET /api/resumes — resumes of the active profile (default first) with "best for N active jobs"
resumesRouter.get('/resumes', async (_req: Request, res: Response) => {
  try {
    res.json(await listResumes());
  } catch (err) {
    console.error('Error listing resumes:', err);
    res.status(500).json({ error: 'Failed to load resumes' });
  }
});

resumesRouter.get('/resumes/rescore-status', (_req: Request, res: Response) => {
  res.json(getRescoreStatus());
});

resumesRouter.get('/resumes/:id', async (req: Request, res: Response) => {
  const { resume } = await ownResume(String(req.params.id));
  if (!resume) return res.status(404).json({ error: 'Resume not found' });
  const counts = await bestForCounts([resume.id]);
  res.json({ ...resume, bestForCount: counts.get(resume.id) ?? 0 });
});

// POST /api/resumes — multipart PDF/text file ("resume" or "file") or JSON/form `content`.
resumesRouter.post(
  '/resumes',
  upload.fields([{ name: 'resume', maxCount: 1 }, { name: 'file', maxCount: 1 }]),
  async (req: Request, res: Response) => {
    try {
      const files = (req.files || {}) as Record<string, Express.Multer.File[]>;
      const file = files.resume?.[0] || files.file?.[0];
      let content = '';
      if (file) {
        const isPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname);
        content = isPdf ? await extractTextFromPdf(file.buffer) : file.buffer.toString('utf-8');
      } else {
        content = str(req.body?.content ?? req.body?.rawText, MAX_CONTENT + 1) || '';
      }
      content = content.trim();
      if (!content) return res.status(400).json({ error: 'Upload a PDF or paste the resume text.' });
      if (content.length > MAX_CONTENT) return res.status(400).json({ error: 'Resume text is too long (100k characters max).' });

      const profile = await ensureActiveProfile();
      const existing = await prisma.resume.count({ where: { candidateProfileId: profile.id } });
      const fileName = file ? file.originalname.slice(0, 200) : null;
      const label =
        str(req.body?.label, 60) ||
        (fileName ? fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').slice(0, 60) : '') ||
        (existing === 0 ? 'General' : `Resume ${existing + 1}`);

      const parsed = parseResumeText(content);
      const resume = await createResume({
        profileId: profile.id,
        label,
        content,
        targetCategory: str(req.body?.targetCategory, 40) || null,
        fileName,
        skills: skillsInput(req.body?.skills) ?? parsed.skills,
        isDefault: req.body?.isDefault === true || req.body?.isDefault === 'true',
      });

      // Fill only empty profile fields from the resume (never overwrite user edits).
      const { data, filled } = profileFillFromResume(profile, parsed);
      if (filled.length) await prisma.candidateProfile.update({ where: { id: profile.id }, data });

      await prisma.auditLog.create({
        data: { action: 'RESUME_CREATED', entityId: resume.id, metadata: { label, skills: resume.skills.length, filledProfileFields: filled } },
      });

      const rescore = await rescoreWithBudget('resume created');
      res.status(201).json({
        resume: { ...resume, bestForCount: 0 },
        parsed: {
          name: parsed.name,
          email: parsed.email,
          phone: parsed.phone,
          links: parsed.linkMap,
          education: parsed.education,
          experienceCount: parsed.experience?.length ?? 0,
          skills: parsed.skills,
        },
        filledProfileFields: filled,
        rescore,
      });
    } catch (err) {
      console.error('Error creating resume:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create resume' });
    }
  }
);

// PATCH /api/resumes/:id — label, targetCategory, skills, content, isDefault, reextractSkills
resumesRouter.patch('/resumes/:id', async (req: Request, res: Response) => {
  try {
    const { profile, resume } = await ownResume(String(req.params.id));
    if (!resume) return res.status(404).json({ error: 'Resume not found' });
    const body = req.body || {};
    const data: Record<string, unknown> = {};

    if (body.label !== undefined) {
      const label = str(body.label, 60);
      if (!label) return res.status(400).json({ error: 'Label cannot be empty' });
      data.label = label;
    }
    if (body.targetCategory !== undefined) data.targetCategory = str(body.targetCategory, 40) || null;
    if (body.content !== undefined) {
      const content = str(body.content, MAX_CONTENT + 1);
      if (!content) return res.status(400).json({ error: 'Resume text cannot be empty' });
      if (content.length > MAX_CONTENT) return res.status(400).json({ error: 'Resume text is too long (100k characters max).' });
      data.content = content;
    }
    if (body.skills !== undefined) {
      if (!Array.isArray(body.skills)) return res.status(400).json({ error: 'skills must be an array' });
      data.skills = normaliseSkills(body.skills);
    } else if (body.reextractSkills === true) {
      data.skills = skillsFromText((data.content as string) ?? resume.content);
    }
    if (body.isDefault === false && resume.isDefault) {
      return res.status(400).json({ error: 'Make another resume the default instead.' });
    }

    await prisma.resume.update({ where: { id: resume.id }, data });
    if (body.isDefault === true && !resume.isDefault) await setDefaultResume(profile.id, resume.id);
    else if (data.content !== undefined && resume.isDefault) {
      await prisma.candidateProfile.update({ where: { id: profile.id }, data: { rawResume: data.content as string } });
    }

    const scoringChanged = data.skills !== undefined || data.content !== undefined;
    const rescore = scoringChanged ? await rescoreWithBudget('resume updated') : null;
    const updated = await prisma.resume.findUnique({ where: { id: resume.id } });
    const counts = await bestForCounts([resume.id]);
    res.json({ resume: { ...updated, bestForCount: counts.get(resume.id) ?? 0 }, rescore });
  } catch (err) {
    console.error('Error updating resume:', err);
    res.status(500).json({ error: 'Failed to update resume' });
  }
});

// POST /api/resumes/:id/default — exactly one default per profile
resumesRouter.post('/resumes/:id/default', async (req: Request, res: Response) => {
  try {
    const { profile, resume } = await ownResume(String(req.params.id));
    if (!resume) return res.status(404).json({ error: 'Resume not found' });
    const updated = await setDefaultResume(profile.id, resume.id);
    res.json({ resume: updated });
  } catch (err) {
    console.error('Error setting default resume:', err);
    res.status(500).json({ error: 'Failed to set default resume' });
  }
});

// DELETE /api/resumes/:id — refuses to delete the last resume; reassigns the default
resumesRouter.delete('/resumes/:id', async (req: Request, res: Response) => {
  try {
    const { profile, resume } = await ownResume(String(req.params.id));
    if (!resume) return res.status(404).json({ error: 'Resume not found' });
    const { newDefaultId } = await deleteResume(profile.id, resume.id);
    const rescore = await rescoreWithBudget('resume deleted');
    res.json({ deleted: resume.id, newDefaultId, rescore });
  } catch (err) {
    if (err instanceof ResumeRuleError) return res.status(409).json({ error: err.message });
    console.error('Error deleting resume:', err);
    res.status(500).json({ error: 'Failed to delete resume' });
  }
});
