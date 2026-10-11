import { prisma } from './db';
import { matchJob } from './matching/engine';

async function seed() {
  console.log('Seeding candidate profile and job listings...');

  // 1. Clean existing records if any
  await prisma.document.deleteMany();
  await prisma.jobApplication.deleteMany();
  await prisma.jobListing.deleteMany();
  await prisma.candidateProfile.deleteMany();
  await prisma.auditLog.deleteMany();

  // 2. Candidate Profile (from Master Build Prompt Section 3)
  const candidateSkills = [
    'JavaScript',
    'TypeScript',
    'React',
    'Next.js',
    'Node.js',
    'Express',
    'PostgreSQL',
    'Prisma',
    'SQL',
    'REST APIs',
    'WebSockets',
    'Redis',
    'Docker',
    'Linux',
    'Git',
  ];

  const profile = await prisma.candidateProfile.create({
    data: {
      name: 'Shourya Upadhyaya',
      skills: candidateSkills,
      education: {
        degree: 'B.Tech Computer Science and Engineering',
        institution: 'VIT Vellore',
        graduationYear: 2028,
        expectedGraduation: 'May 2028',
        location: 'India',
      },
      experience: {
        target: '2027 software engineering internships (Pre-placement offer opportunity)',
        careerGoal: 'Software engineering roles paying at least ₹10 LPA',
        preferredRoles: [
          'Software Engineering Intern',
          'Backend Engineering Intern',
          'Full-Stack Engineering Intern',
          'Developer Infrastructure Intern',
        ],
        projects: [
          {
            name: 'VoiceShield-AI',
            description: 'AI-driven telecom defense & voice media testing engine using FreeSWITCH and PostgreSQL.',
            technologies: ['TypeScript', 'Docker', 'PostgreSQL', 'Linux', 'WebSockets'],
          },
          {
            name: 'OpenPumTa',
            description: 'Open-source distributed application infrastructure tooling.',
            technologies: ['TypeScript', 'Node.js', 'Next.js', 'Prisma', 'REST APIs'],
          },
        ],
      },
    },
  });

  console.log(`Created Candidate Profile: ${profile.name} (${profile.id})`);

  // 3. Raw Job Listings to evaluate and seed
  const rawJobs = [
    {
      externalId: 'job-stripe-2027-backend',
      source: 'Stripe Careers (JSON Feed)',
      title: 'Backend Engineering Intern (Summer 2027)',
      company: 'Stripe',
      url: 'https://stripe.com/jobs/backend-intern',
      description: `Join Stripe as a Backend Engineering Intern. You will design and implement resilient REST APIs and backend microservices using TypeScript, Node.js, and PostgreSQL. Experience with Docker, Redis, and Linux distributed systems is preferred.`,
    },
    {
      externalId: 'job-zepto-2027-fullstack',
      source: 'Zepto Campus Engineering',
      title: 'Full-Stack Engineering Intern',
      company: 'Zepto',
      url: 'https://zepto.com/careers/fullstack-intern',
      description: `We are hiring Full-Stack Engineering Interns. Work across Next.js and React frontend dashboards, Express and Node.js backend services, with PostgreSQL and Prisma data layers. Fast-paced environment with high ownership.`,
    },
    {
      externalId: 'job-postman-2027-devinfra',
      source: 'Postman Developer Platform',
      title: 'Developer Infrastructure Intern',
      company: 'Postman',
      url: 'https://postman.com/jobs/dev-infra',
      description: `Developer Infrastructure Intern to build internal developer platforms, CI/CD automation, and developer tooling. Requires solid proficiency in Linux, Git, Docker, and TypeScript API tooling.`,
    },
    {
      externalId: 'job-razorpay-2027-swe',
      source: 'Razorpay Jobs RSS',
      title: 'Software Engineering Intern - Payments Core',
      company: 'Razorpay',
      url: 'https://razorpay.com/careers/swe-intern',
      description: `Looking for talented students graduating 2027/2028. You will build high-throughput financial pipelines using SQL, PostgreSQL, Node.js, WebSockets, and Redis. Pre-placement offer (PPO) opportunity for top performers.`,
    },
    {
      externalId: 'job-atlassian-2027-cloud',
      source: 'Atlassian Global RSS',
      title: 'Cloud Systems Platform Intern',
      company: 'Atlassian',
      url: 'https://atlassian.com/careers/intern-cloud',
      description: `Platform engineering role focusing on cloud observability, Linux systems administration, Docker container orchestration, and reliability monitoring. Knowledge of Python, Golang or Linux shell scripting is a plus.`,
    },
    {
      externalId: 'job-legacy-mainframe-2027',
      source: 'Legacy Corp Board',
      title: 'Mainframe COBOL Maintenance Specialist',
      company: 'Global Banking Systems Corp',
      url: 'https://example.com/jobs/cobol',
      description: `Seeking engineers with 10+ years experience in IBM z/OS, COBOL, JCL, and CICS mainframe financial transaction processing. On-site 5 days a week.`,
    },
  ];

  // 4. Ingest and match jobs through the Matching Engine
  const createdJobs = [];
  for (const rawJob of rawJobs) {
    const match = matchJob(profile, rawJob);
    const job = await prisma.jobListing.create({
      data: {
        externalId: rawJob.externalId,
        source: rawJob.source,
        title: rawJob.title,
        company: rawJob.company,
        url: rawJob.url,
        description: rawJob.description,
        score: match.score,
        status: match.classification, // APPLY, REVIEW, SKIP
      },
    });
    createdJobs.push(job);
    console.log(`Ingested: [${match.classification}] (Score: ${match.score}) ${job.title} @ ${job.company}`);
  }

  // 5. Create a sample draft application for the highest match job
  const topJob = createdJobs[0];
  const application = await prisma.jobApplication.create({
    data: {
      jobListingId: topJob.id,
      candidateProfileId: profile.id,
      status: 'DRAFT',
      isApproved: false,
      notes: 'Initial copilot draft generated. Pending review and human approval before external submission.',
    },
  });

  await prisma.document.create({
    data: {
      type: 'COVER_LETTER',
      version: 1,
      content: `Dear Hiring Team at ${topJob.company},\n\nI am writing to express my strong interest in the ${topJob.title} role. As a B.Tech Computer Science student at VIT Vellore with hands-on experience developing backend microservices and distributed systems (such as VoiceShield-AI and OpenPumTa using TypeScript, Node.js, PostgreSQL, Docker, and Redis), I am eager to contribute to Stripe's payment infrastructure.\n\nThank you for your consideration.\n\nSincerely,\nShourya Upadhyaya`,
      candidateProfileId: profile.id,
      jobApplicationId: application.id,
    },
  });

  // 6. Log audit entry
  await prisma.auditLog.create({
    data: {
      action: 'SYSTEM_SEED',
      entityId: profile.id,
      metadata: {
        profileCreated: profile.name,
        jobsCreated: createdJobs.length,
        applicationCreated: application.id,
      },
    },
  });

  console.log('Database successfully seeded with realistic profile, matched jobs, and application copilot document!');
}

seed()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
