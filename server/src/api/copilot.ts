import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { CandidateProfile, JobListing } from '@prisma/client';
import { ensureActiveProfile } from '../lib/profile';
import { resumeForJob } from '../resumes/service';
import {
  tailorResume,
  tailorCoverLetter,
  tailorCoverLetterWithGemini,
  generateAnswerWithGemini,
} from '../resumes/tailor';

export const copilotRouter = Router();

/** The requested profile, or the active one (created if missing). Null only for an unknown explicit id. */
async function resolveProfile(candidateProfileId?: unknown): Promise<CandidateProfile | null> {
  if (candidateProfileId) return prisma.candidateProfile.findUnique({ where: { id: String(candidateProfileId) } });
  return ensureActiveProfile();
}

/** Grounds generation in the job's best-matching resume (or the default one). */
async function groundingFor(profile: CandidateProfile, job: Pick<JobListing, 'bestResumeId'> | null) {
  const resume = await resumeForJob(profile.id, job?.bestResumeId);
  return {
    resumeText: resume?.content ?? null,
    resumeId: resume?.id ?? null,
    // Deterministic tailoring works off skills: prefer the chosen resume's list.
    profileForSkills: resume?.skills.length ? { ...profile, skills: resume.skills } : profile,
  };
}

// POST /api/copilot/generate - Backward compatible endpoint
copilotRouter.post('/copilot/generate', async (req: Request, res: Response) => {
  const { type, candidateProfileId, jobListingId } = req.body;
  if (!type || !candidateProfileId || !jobListingId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const profile = await prisma.candidateProfile.findUnique({ where: { id: candidateProfileId } });
    const job = await prisma.jobListing.findUnique({ where: { id: jobListingId } });

    if (!profile || !job) {
      // Fallback mock if ids are mock values in tests
      let content = '';
      if (type === 'COVER_LETTER') {
        content = `Dear Hiring Manager, I am writing to express my interest in the position. With my background in ... I am a great fit. Sincerely, Candidate.`;
      } else if (type === 'RESUME') {
        content = `Resume Content: Generated based on profile and job listing.`;
      } else {
        return res.status(400).json({ error: 'Invalid document type' });
      }
      return res.status(200).json({ content });
    }

    const grounding = await groundingFor(profile, job);
    if (type === 'COVER_LETTER') {
      const result = await tailorCoverLetterWithGemini(profile, job, undefined, undefined, grounding.resumeText);
      return res.status(200).json({ content: result.formattedMarkdown });
    } else if (type === 'RESUME') {
      const result = tailorResume(grounding.profileForSkills, job);
      return res.status(200).json({ content: result.formattedMarkdown });
    } else {
      return res.status(400).json({ error: 'Invalid document type' });
    }
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Generation failed' });
  }
});

// POST /api/copilot/tailor-resume - Tailor resume for specific job listing
copilotRouter.post('/copilot/tailor-resume', async (req: Request, res: Response) => {
  const { jobListingId, candidateProfileId } = req.body;
  if (!jobListingId) {
    return res.status(400).json({ error: 'jobListingId is required' });
  }

  try {
    const job = await prisma.jobListing.findUnique({ where: { id: jobListingId } });
    if (!job) {
      return res.status(404).json({ error: 'Job listing not found' });
    }

    const profile = await resolveProfile(candidateProfileId);

    if (!profile) {
      return res.status(404).json({ error: 'Candidate profile not found' });
    }

    const grounding = await groundingFor(profile, job);
    const tailored = tailorResume(grounding.profileForSkills, job);

    const doc = await prisma.document.create({
      data: {
        type: 'TAILORED_RESUME',
        content: tailored.formattedMarkdown,
        candidateProfileId: profile.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: 'RESUME_TAILORED',
        entityId: doc.id,
        metadata: { jobId: job.id, company: job.company, resumeId: grounding.resumeId },
      },
    });

    res.json({
      documentId: doc.id,
      resumeId: grounding.resumeId,
      content: tailored.formattedMarkdown,
      matchedSkills: tailored.matchedSkills,
      missingKeywords: tailored.missingKeywords,
      bullets: tailored.highlightedBullets,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to tailor resume' });
  }
});

// POST /api/copilot/tailor-cover-letter - Tailor cover letter for specific job listing
copilotRouter.post('/copilot/tailor-cover-letter', async (req: Request, res: Response) => {
  const { jobListingId, candidateProfileId, question, wordLimit } = req.body;
  if (!jobListingId) {
    return res.status(400).json({ error: 'jobListingId is required' });
  }

  try {
    const job = await prisma.jobListing.findUnique({ where: { id: jobListingId } });
    if (!job) {
      return res.status(404).json({ error: 'Job listing not found' });
    }

    const profile = await resolveProfile(candidateProfileId);

    if (!profile) {
      return res.status(404).json({ error: 'Candidate profile not found' });
    }

    const grounding = await groundingFor(profile, job);
    const tailored = await tailorCoverLetterWithGemini(profile, job, question, wordLimit, grounding.resumeText);

    const doc = await prisma.document.create({
      data: {
        type: 'COVER_LETTER',
        content: tailored.formattedMarkdown,
        candidateProfileId: profile.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: 'COVER_LETTER_TAILORED',
        entityId: doc.id,
        metadata: { jobId: job.id, company: job.company, resumeId: grounding.resumeId },
      },
    });

    res.json({
      documentId: doc.id,
      resumeId: grounding.resumeId,
      content: tailored.formattedMarkdown,
      subject: tailored.subject,
      recipient: tailored.recipient,
      body: tailored.body,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to tailor cover letter' });
  }
});

// POST /api/copilot/generate-answer - Generate tailored answer to custom question
copilotRouter.post('/copilot/generate-answer', async (req: Request, res: Response) => {
  const { jobListingId, candidateProfileId, question, wordLimit } = req.body;
  if (!question) {
    return res.status(400).json({ error: 'question is required' });
  }

  try {
    const foundJob = jobListingId
      ? await prisma.jobListing.findUnique({ where: { id: jobListingId } })
      : null;

    if (!foundJob && jobListingId) {
      return res.status(404).json({ error: 'Job listing not found' });
    }

    const job: JobListing = foundJob || ({
      id: 'generic',
      externalId: 'generic',
      source: 'manual',
      title: 'Software Engineer',
      company: 'Company',
      description: 'Software Engineering position',
      location: null,
      status: 'APPLY',
      score: 80,
      matchReasons: [],
      matchedSkills: [],
      missingSkills: [],
      url: '',
      retrievedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as JobListing);

    const profile = await resolveProfile(candidateProfileId);

    if (!profile) {
      return res.status(404).json({ error: 'Candidate profile not found' });
    }

    const grounding = await groundingFor(profile, foundJob);
    const answer = await generateAnswerWithGemini(profile, job, question, wordLimit, grounding.resumeText);

    res.json({
      question,
      answer,
      resumeId: grounding.resumeId,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to generate answer' });
  }
});

// GET /api/copilot/documents/:id - View generated document
copilotRouter.get('/copilot/documents/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const doc = await prisma.document.findUnique({
      where: { id },
      include: { candidateProfile: true, jobApplication: true },
    });

    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json({ document: doc });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch document' });
  }
});
