import { Router } from 'express';

export const copilotRouter = Router();

copilotRouter.post('/copilot/generate', async (req, res) => {
  const { type, candidateProfileId, jobListingId } = req.body;
  if (!type || !candidateProfileId || !jobListingId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Mock LLM generation
  let content = '';
  if (type === 'COVER_LETTER') {
    content = `Dear Hiring Manager, I am writing to express my interest in the position. With my background in ... I am a great fit. Sincerely, Candidate.`;
  } else if (type === 'RESUME') {
    content = `Resume Content: Generated based on profile and job listing.`;
  } else {
    return res.status(400).json({ error: 'Invalid document type' });
  }

  res.status(200).json({ content });
});
