import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LeverConnector } from '../connectors/lever';

describe('LeverConnector', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should parse valid Lever postings into normalized raw payloads', async () => {
    const mockPostings = [
      {
        id: 'lever-101',
        text: 'Software Engineer Intern - Summer 2027',
        hostedUrl: 'https://jobs.lever.co/spotify/lever-101',
        descriptionPlain: 'Build scalable streaming services with TypeScript and Python.',
        categories: {
          commitment: 'Internship',
          department: 'Engineering',
          location: 'Stockholm, Sweden',
        },
      },
      {
        id: 'lever-102',
        text: 'Backend Engineer',
        hostedUrl: 'https://jobs.lever.co/spotify/lever-102',
        description: '<p>Distributed systems in <strong>Go and Java</strong>.</p>',
        additional: 'Spotify is an equal opportunity employer.',
        categories: {
          allLocations: ['New York, NY', 'Remote, US'],
        },
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockPostings,
    } as Response);

    const connector = new LeverConnector('spotify', 'Spotify');
    const jobs = await connector.fetchJobs();

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      externalId: 'lever-101',
      source: 'lever',
      title: 'Software Engineer Intern - Summer 2027',
      company: 'Spotify',
      url: 'https://jobs.lever.co/spotify/lever-101',
      location: 'Stockholm, Sweden',
    });
    expect(jobs[0].description).toContain('TypeScript and Python');

    expect(jobs[1].externalId).toMatch('lever-102');
    expect(jobs[1].location).toBe('New York, NY, Remote, US');
    expect(jobs[1].description).toContain('Distributed systems in Go and Java');
    expect(jobs[1].description).toContain('equal opportunity employer');
  });

  it('should throw an informative error if response is not an array', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ error: 'Invalid organization' }),
    } as Response);

    const connector = new LeverConnector('invalid-org');
    await expect(connector.fetchJobs()).rejects.toThrow('Unexpected Lever API response format');
  });

  it('should construct correct endpoint URL', () => {
    const connector = new LeverConnector('netflix');
    expect(connector.getEndpoint()).toBe('https://api.lever.co/v0/postings/netflix?mode=json');
  });
});
