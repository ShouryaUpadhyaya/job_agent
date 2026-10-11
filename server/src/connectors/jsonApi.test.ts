import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JsonApiConnector } from './jsonApi';

describe('JsonApiConnector', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('should fetch and map jobs correctly', async () => {
    const mockData = [{ job_id: '1', job_title: 'Engineer', job_company: 'Tech' }];
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockData
    });

    const connector = new JsonApiConnector('http://example.com/api/jobs', (data: any[]) => {
      return data.map(job => ({
        id: job.job_id,
        title: job.job_title,
        company: job.job_company,
        url: `http://example.com/job/${job.job_id}`
      }));
    });

    const jobs = await connector.fetchJobs();
    expect(global.fetch).toHaveBeenCalledWith('http://example.com/api/jobs');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual({
      id: '1',
      title: 'Engineer',
      company: 'Tech',
      url: 'http://example.com/job/1'
    });
  });

  it('should throw an error on failed fetch', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      statusText: 'Not Found'
    });

    const connector = new JsonApiConnector('http://example.com/api/jobs', (data) => data);
    await expect(connector.fetchJobs()).rejects.toThrow('Failed to fetch JSON API: Not Found');
  });
});
