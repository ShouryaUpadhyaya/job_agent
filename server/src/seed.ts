/**
 * Seeds the candidate profile only, and only when none exists. It never deletes data and never
 * creates job listings (jobs come from real sources: ATS feeds, alert emails, manual imports).
 *   npx tsx src/seed.ts
 */
import { prisma } from './db';

async function seed() {
  const existing = await prisma.candidateProfile.findFirst({ orderBy: { id: 'asc' } });
  if (existing) {
    console.log(`Profile already exists (${existing.name}); nothing to seed.`);
    return;
  }

  const profile = await prisma.candidateProfile.create({
    data: {
      name: 'Shourya Upadhyaya',
      targetRole: 'Software Engineer Intern',
      targetGradYear: 2028,
      preferredLocations: ['India', 'Remote'],
      remoteOk: true,
      school: 'VIT Vellore',
      skills: [
        'JavaScript', 'TypeScript', 'React', 'Next.js', 'Node.js', 'Express', 'PostgreSQL', 'Prisma',
        'SQL', 'REST APIs', 'WebSockets', 'Redis', 'Docker', 'Linux', 'Git',
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
  });

  console.log(`Created candidate profile: ${profile.name} (${profile.id}). Edit it in the Profile tab.`);
}

seed()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
