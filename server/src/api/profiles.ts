import { Router, Request, Response } from 'express';
import multer from 'multer';
import { prisma } from '../db';
import { extractTextFromPdf, parseResumeText, ParsedResume } from '../resumes/parser';
import { matchJob } from '../matching/engine';

export const profilesRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// GET /api/profiles - Get current candidate profile
profilesRouter.get('/profiles', async (_req: Request, res: Response) => {
  try {
    let profile = await prisma.candidateProfile.findFirst({
      orderBy: { id: 'asc' },
      include: {
        documents: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!profile) {
      profile = await prisma.candidateProfile.create({
        data: {
          name: 'Shourya Upadhyaya',
          email: 'shourya@example.com',
          targetRole: 'Software Engineer Intern',
          targetGradYear: 2028,
          skills: [
            'JavaScript', 'TypeScript', 'React', 'Next.js', 'Node.js', 'Express',
            'PostgreSQL', 'Prisma', 'SQL', 'REST APIs', 'WebSockets', 'Redis',
            'Docker', 'Linux', 'Git',
          ],
          education: {
            degree: 'B.Tech Computer Science and Engineering',
            institution: 'VIT Vellore',
            graduationYear: 2028,
          },
          experience: {
            target: '2027 software engineering internships',
            preferredRoles: ['Backend Engineering Intern', 'Full-Stack Engineering Intern'],
          },
        },
        include: { documents: true },
      });
    }

    res.json(profile);
  } catch (error: any) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/profiles - Create or update candidate profile
profilesRouter.post('/profiles', async (req: Request, res: Response) => {
  const { id, name, email, targetRole, targetGradYear, skills, experience, education, rawResume } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  try {
    let profile;
    const data = {
      name,
      email: email || null,
      targetRole: targetRole || 'Software Engineer Intern',
      targetGradYear: targetGradYear ? Number(targetGradYear) : 2028,
      skills: Array.isArray(skills) ? skills : [],
      experience: experience || null,
      education: education || null,
      rawResume: rawResume || null,
    };

    if (id) {
      profile = await prisma.candidateProfile.upsert({
        where: { id },
        update: data,
        create: { id, ...data },
      });
    } else {
      const existing = await prisma.candidateProfile.findFirst({ orderBy: { id: 'asc' } });
      if (existing) {
        profile = await prisma.candidateProfile.update({
          where: { id: existing.id },
          data,
        });
      } else {
        profile = await prisma.candidateProfile.create({ data });
      }
    }

    await prisma.auditLog.create({
      data: {
        action: 'CANDIDATE_PROFILE_UPDATED',
        entityId: profile.id,
        metadata: { name: profile.name, skillsCount: profile.skills.length },
      },
    });

    return res.status(200).json(profile);
  } catch (error: any) {
    console.error('Error creating/updating profile:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/profiles/upload-resume - Upload and parse PDF or text resume
profilesRouter.post(
  '/profiles/upload-resume',
  upload.single('resume'),
  async (req: Request, res: Response) => {
    try {
      let rawText = '';

      if (req.file) {
        if (req.file.mimetype === 'application/pdf' || req.file.originalname.endsWith('.pdf')) {
          rawText = await extractTextFromPdf(req.file.buffer);
        } else {
          rawText = req.file.buffer.toString('utf-8');
        }
      } else if (req.body.rawText) {
        rawText = String(req.body.rawText);
      } else {
        return res.status(400).json({ error: 'Please upload a PDF file or provide rawText' });
      }

      if (!rawText.trim()) {
        return res.status(400).json({ error: 'Resume content was empty or unparseable' });
      }

      const parsed: ParsedResume = parseResumeText(rawText);

      // Upsert into active CandidateProfile
      let profile = await prisma.candidateProfile.findFirst({ orderBy: { id: 'asc' } });
      const profileData = {
        name: parsed.name !== 'Candidate' ? parsed.name : (profile?.name || 'Candidate'),
        email: parsed.email || profile?.email || null,
        targetGradYear: parsed.education?.graduationYear || profile?.targetGradYear || 2028,
        targetRole: profile?.targetRole || 'Software Engineer Intern',
        skills: Array.from(new Set([...(profile?.skills || []), ...parsed.skills])),
        education: parsed.education || profile?.education || null,
        experience: parsed.experience || profile?.experience || null,
        rawResume: rawText,
      };

      if (profile) {
        profile = await prisma.candidateProfile.update({
          where: { id: profile.id },
          data: profileData as any,
        });
      } else {
        profile = await prisma.candidateProfile.create({
          data: profileData as any,
        });
      }

      // Store resume document
      const doc = await prisma.document.create({
        data: {
          type: 'RESUME',
          version: 1,
          content: rawText,
          candidateProfileId: profile.id,
        },
      });

      // Rescore jobs against the updated profile
      const jobs = await prisma.jobListing.findMany({ take: 200 });
      let rescoredCount = 0;
      for (const job of jobs) {
        const match = matchJob(profile, {
          title: job.title,
          description: job.description,
          company: job.company,
          location: job.location,
        });

        await prisma.jobListing.update({
          where: { id: job.id },
          data: {
            score: match.score,
            status: match.classification,
            matchReasons: match.reasons,
            matchedSkills: match.matchedSkills,
            missingSkills: match.missingSkills,
          },
        });
        rescoredCount++;
      }

      await prisma.auditLog.create({
        data: {
          action: 'RESUME_PARSED_AND_SYNCED',
          entityId: profile.id,
          metadata: {
            extractedSkills: parsed.skills,
            extractedEmail: parsed.email,
            rescoredCount,
          },
        },
      });

      res.status(200).json({
        success: true,
        profile,
        documentId: doc.id,
        parsedSummary: {
          name: parsed.name,
          email: parsed.email,
          skillsFound: parsed.skills.length,
          skills: parsed.skills,
          graduationYear: parsed.education?.graduationYear,
        },
        rescoredCount,
      });
    } catch (err: any) {
      console.error('Error parsing resume:', err);
      res.status(500).json({ error: err.message || 'Failed to process resume' });
    }
  }
);
