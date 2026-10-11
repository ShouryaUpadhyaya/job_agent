import { Router } from 'express';
import { prisma } from '../db';

export const profilesRouter = Router();

profilesRouter.post('/profiles', async (req, res) => {
  const { id, name, skills, experience, education } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  
  try {
    let profile;
    if (id) {
      profile = await prisma.candidateProfile.upsert({
        where: { id },
        update: { name, skills: skills || [], experience, education },
        create: { id, name, skills: skills || [], experience, education },
      });
    } else {
      profile = await prisma.candidateProfile.create({
        data: { name, skills: skills || [], experience, education },
      });
    }
    return res.status(200).json(profile);
  } catch (error) {
    console.error('Error creating/updating profile:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
