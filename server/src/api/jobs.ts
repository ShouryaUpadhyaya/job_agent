import { Router } from 'express';
import { prisma } from '../db';

export const jobsRouter = Router();

jobsRouter.get('/jobs', async (req, res) => {
  try {
    const { status, minScore, search, source, sortBy, sortOrder } = req.query;

    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = String(status);
    }
    if (minScore) {
      where.score = { gte: parseInt(String(minScore), 10) };
    }
    if (source) {
      where.source = { contains: String(source), mode: 'insensitive' };
    }
    if (search) {
      const searchStr = String(search);
      where.OR = [
        { title: { contains: searchStr, mode: 'insensitive' } },
        { company: { contains: searchStr, mode: 'insensitive' } },
        { description: { contains: searchStr, mode: 'insensitive' } },
      ];
    }

    const orderBy: any = {};
    const validSortFields = ['createdAt', 'score', 'title', 'company', 'retrievedAt'];
    const field = validSortFields.includes(String(sortBy)) ? String(sortBy) : 'createdAt';
    const order = String(sortOrder).toLowerCase() === 'asc' ? 'asc' : 'desc';
    
    orderBy[field] = order;

    const jobs = await prisma.jobListing.findMany({
      where,
      orderBy,
    });
    res.json(jobs);
  } catch (error) {
    console.error('Error fetching jobs:', error);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

jobsRouter.get('/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const job = await prisma.jobListing.findUnique({
      where: { id },
      include: {
        applications: true,
      },
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);
  } catch (error) {
    console.error('Error fetching job by id:', error);
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

// Import Wellfound job listing
jobsRouter.post('/jobs/import/wellfound', async (req, res) => {
  try {
    const { normalizeWellfoundJob } = await import('../connectors/wellfound');
    const { processAndUpsertJob } = await import('../jobs/normalization');

    const { url, title, company, description, location, salary, equity, stage, tags } = req.body;
    if (!url || !title || !company || !description) {
      return res.status(400).json({ error: 'url, title, company, and description are required' });
    }

    const raw = normalizeWellfoundJob({ url, title, company, description, location, salary, equity, stage, tags });
    const profile = await prisma.candidateProfile.findFirst();
    const result = await processAndUpsertJob(raw, profile);

    res.status(result.isNew ? 201 : 200).json({
      message: result.isNew ? 'Job imported successfully' : 'Job listing updated',
      job: result.listing,
      isNew: result.isNew,
    });
  } catch (error: any) {
    console.error('Error importing Wellfound job:', error);
    res.status(500).json({ error: error.message });
  }
});

// Scrape LinkedIn job details by URL without credentials (guest API)
jobsRouter.post('/jobs/scrape/linkedin', async (req, res) => {
  try {
    const { scrapeLinkedInJobByUrl } = await import('../connectors/linkedin');
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'url is required' });
    }

    const data = await scrapeLinkedInJobByUrl(url);
    res.json({ success: true, data });
  } catch (error: any) {
    console.error('Error scraping LinkedIn job:', error);
    res.status(422).json({ error: error.message || 'Failed to scrape LinkedIn job' });
  }
});

// Import LinkedIn job listing (with auto-scraping and optional pipeline tracking)
jobsRouter.post('/jobs/import/linkedin', async (req, res) => {
  try {
    const { normalizeLinkedInJob, scrapeLinkedInJobByUrl } = await import('../connectors/linkedin');
    const { processAndUpsertJob } = await import('../jobs/normalization');

    let { url, title, company, description, location, isEasyApply, workplaceType, tags, trackInPipeline, stage, notes } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'url is required' });
    }

    // If required fields are missing, attempt automatic guest scrape
    if (!title || !company || !description) {
      try {
        const scraped = await scrapeLinkedInJobByUrl(url);
        title = title || scraped.title;
        company = company || scraped.company;
        location = location || scraped.location;
        description = description || scraped.description;
        if (isEasyApply === undefined && scraped.isEasyApply !== undefined) {
          isEasyApply = scraped.isEasyApply;
        }
      } catch (scrapeErr: any) {
        if (!title || !company || !description) {
          return res.status(400).json({
            error: `Could not automatically scrape LinkedIn job details: ${scrapeErr.message}. Please enter title, company, and description manually.`,
          });
        }
      }
    }

    const raw = normalizeLinkedInJob({ url, title, company, description, location, isEasyApply, workplaceType, tags });
    const profile = await prisma.candidateProfile.findFirst();
    const result = await processAndUpsertJob(raw, profile);

    let application = null;
    if (trackInPipeline || stage) {
      const targetStage = stage || 'BOOKMARKED';
      const isApproved = targetStage === 'APPLIED';
      const existingApp = await prisma.jobApplication.findFirst({
        where: {
          jobListingId: result.listing.id,
          candidateProfileId: profile?.id,
        },
      });

      if (existingApp) {
        application = await prisma.jobApplication.update({
          where: { id: existingApp.id },
          data: {
            stage: targetStage,
            status: targetStage,
            notes: notes || existingApp.notes || undefined,
          },
        });
      } else {
        application = await prisma.jobApplication.create({
          data: {
            jobListingId: result.listing.id,
            candidateProfileId: profile?.id || '',
            stage: targetStage,
            status: targetStage,
            isApproved,
            notes: notes || `Imported via LinkedIn link (${result.listing.score ?? 0} pts match)`,
          },
        });
      }
    }

    res.status(result.isNew ? 201 : 200).json({
      message: result.isNew ? 'Job imported successfully' : 'Job listing updated',
      job: result.listing,
      isNew: result.isNew,
      application,
    });
  } catch (error: any) {
    console.error('Error importing LinkedIn job:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get pre-application checklist for a job
jobsRouter.get('/jobs/:id/checklist', async (req, res) => {
  try {
    const { generatePreApplicationChecklist } = await import('../connectors/linkedin');

    const job = await prisma.jobListing.findUnique({
      where: { id: req.params.id },
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const checklist = generatePreApplicationChecklist({
      title: job.title,
      company: job.company,
      url: job.url,
      tags: job.matchedSkills,
    });

    res.json({ job, checklist });
  } catch (error: any) {
    console.error('Error generating checklist:', error);
    res.status(500).json({ error: error.message });
  }
});

