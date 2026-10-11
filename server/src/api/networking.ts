import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { networkingCrmService } from '../networking/crm';

export const networkingRouter = Router();

// 1. List contacts
networkingRouter.get('/networking/contacts', async (req: Request, res: Response) => {
  try {
    const { company, status, vitAlumni, search } = req.query;
    const where: any = {};

    if (company && typeof company === 'string') {
      where.company = { contains: company, mode: 'insensitive' };
    }

    if (status && typeof status === 'string') {
      where.status = status;
    }

    if (vitAlumni !== undefined) {
      where.vitAlumni = vitAlumni === 'true';
    }

    if (search && typeof search === 'string') {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
        { role: { contains: search, mode: 'insensitive' } },
      ];
    }

    const contacts = await prisma.networkingContact.findMany({
      where,
      orderBy: [{ relevanceScore: 'desc' }, { createdAt: 'desc' }],
      include: {
        targetJob: true,
        messages: { orderBy: { createdAt: 'desc' } },
      },
    });

    res.json(contacts);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Create contact
networkingRouter.post('/networking/contacts', async (req: Request, res: Response) => {
  try {
    const { name, company, role, profileUrl, headline, team, vitAlumni, outreachAngle, relevanceScore, targetJobId, status, notes } = req.body;

    if (!name || !company || !role || !profileUrl) {
      return res.status(400).json({ error: 'name, company, role, and profileUrl are required' });
    }

    const contact = await prisma.networkingContact.create({
      data: {
        name,
        company,
        role,
        profileUrl,
        headline,
        team,
        vitAlumni: Boolean(vitAlumni),
        outreachAngle,
        relevanceScore: relevanceScore ?? (vitAlumni ? 95 : 85),
        targetJobId,
        status: status || 'RESEARCHED',
        notes,
      },
      include: { targetJob: true, messages: true },
    });

    res.status(201).json(contact);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Get single contact
networkingRouter.get('/networking/contacts/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const contact = await prisma.networkingContact.findUnique({
      where: { id },
      include: {
        targetJob: true,
        messages: { orderBy: { createdAt: 'desc' } },
        emailEvents: { orderBy: { receivedAt: 'desc' } },
      },
    });

    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    res.json(contact);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Update contact
networkingRouter.patch('/networking/contacts/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { notes, status, nextFollowUpAt, profileUrl, role, team } = req.body;
    const data: any = {};
    if (notes !== undefined) data.notes = notes;
    if (status !== undefined) data.status = status;
    if (nextFollowUpAt !== undefined) data.nextFollowUpAt = nextFollowUpAt ? new Date(nextFollowUpAt) : null;
    if (profileUrl !== undefined) data.profileUrl = profileUrl;
    if (role !== undefined) data.role = role;
    if (team !== undefined) data.team = team;

    const updated = await prisma.networkingContact.update({
      where: { id },
      data,
      include: { targetJob: true, messages: true },
    });

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Stage transition
networkingRouter.post('/networking/contacts/:id/transition', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { newStage, notes } = req.body;
    if (!newStage) {
      return res.status(400).json({ error: 'newStage is required' });
    }

    const updated = await networkingCrmService.transitionStage(id, newStage, notes);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Generate connection note (<300 chars)
networkingRouter.post('/networking/contacts/:id/generate-note', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const contact = await prisma.networkingContact.findUnique({
      where: { id },
    });

    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const note = networkingCrmService.generateConnectionNote(contact);

    // Persist as draft message
    const message = await prisma.networkingMessage.create({
      data: {
        contactId: contact.id,
        type: 'CONNECTION_REQUEST',
        content: note.content,
        status: 'DRAFT',
      },
    });

    res.json({ note, message });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Generate referral follow-up
networkingRouter.post('/networking/contacts/:id/generate-referral', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const referralMsg = await networkingCrmService.generateReferralFollowUp(id);

    const message = await prisma.networkingMessage.create({
      data: {
        contactId: id,
        type: 'REFERRAL_FOLLOWUP',
        content: referralMsg.content,
        status: 'DRAFT',
      },
    });

    res.json({ referralMsg, message });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 8. Auto-research target personas for a company
networkingRouter.post('/networking/generate-targets', async (req: Request, res: Response) => {
  try {
    const { company, targetJobId, saveToDb } = req.body;
    if (!company) {
      return res.status(400).json({ error: 'company is required' });
    }

    const targets = await networkingCrmService.generateTargetContactsForCompany(company, targetJobId);

    if (saveToDb) {
      const createdContacts = [];
      for (const t of targets) {
        const contact = await prisma.networkingContact.create({
          data: {
            name: t.name,
            company: t.company,
            role: t.role,
            profileUrl: t.searchUrl,
            headline: t.headline,
            team: t.team,
            vitAlumni: t.vitAlumni,
            outreachAngle: t.outreachAngle,
            relevanceScore: t.relevanceScore,
            targetJobId,
            status: 'RESEARCHED',
          },
        });
        createdContacts.push(contact);
      }
      return res.status(201).json({ targets, createdContacts });
    }

    res.json({ targets });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 9. Delete contact
networkingRouter.delete('/networking/contacts/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    await prisma.networkingMessage.deleteMany({
      where: { contactId: id },
    });
    await prisma.networkingContact.delete({
      where: { id },
    });
    res.json({ message: 'Contact deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
