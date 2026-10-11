import { prisma } from '../db';
import { JobListing } from '@prisma/client';

export type RawJobListing = Omit<JobListing, 'id' | 'createdAt' | 'updatedAt'>;

export async function upsertJobListing(job: RawJobListing): Promise<JobListing> {
  return prisma.jobListing.upsert({
    where: {
      externalId_source: {
        externalId: job.externalId,
        source: job.source,
      },
    },
    update: {
      title: job.title,
      company: job.company,
      url: job.url,
      description: job.description,
      status: job.status,
      score: job.score,
    },
    create: job,
  });
}
