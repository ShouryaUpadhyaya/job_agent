import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GreenhouseConnector } from '../connectors/greenhouse';
import { AshbyConnector } from '../connectors/ashby';
import { ArbeitnowConnector } from '../connectors/arbeitnow';

describe('Production Job Connectors (Unit & Fixtures)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('GreenhouseConnector', () => {
    it('should parse Greenhouse fixture into normalized RawJobPayload', async () => {
      const mockGreenhouseResponse = {
        jobs: [
          {
            id: 123456,
            title: 'Systems Engineer',
            company_name: 'Cloudflare',
            absolute_url: 'https://boards.greenhouse.io/cloudflare/jobs/123456?gh_jid=123456',
            location: { name: 'Remote, India' },
            content: '&lt;p&gt;Looking for a systems engineer with &lt;strong&gt;Linux&lt;/strong&gt; and &lt;strong&gt;Go&lt;/strong&gt;.&lt;/p&gt;',
            updated_at: '2026-10-01T12:00:00Z',
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockGreenhouseResponse,
      });

      const connector = new GreenhouseConnector('cloudflare', 'Cloudflare', 'http://mock-greenhouse.test/jobs');
      const jobs = await connector.fetchJobs();

      expect(jobs).toHaveLength(1);
      expect(jobs[0].externalId).toBe('123456');
      expect(jobs[0].source).toBe('Greenhouse');
      expect(jobs[0].title).toBe('Systems Engineer');
      expect(jobs[0].company).toBe('Cloudflare');
      expect(jobs[0].location).toBe('Remote, India');
      // Strips gh_jid tracking param
      expect(jobs[0].url).toBe('https://boards.greenhouse.io/cloudflare/jobs/123456');
      expect(jobs[0].description).toContain('Linux');
    });

    it('should handle empty jobs array gracefully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ jobs: [] }),
      });

      const connector = new GreenhouseConnector('test', 'Test Co', 'http://mock-greenhouse.test/jobs');
      const jobs = await connector.fetchJobs();
      expect(jobs).toEqual([]);
    });

    it('should throw observable error when HTTP fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const connector = new GreenhouseConnector('invalid', 'Invalid Co', 'http://mock-greenhouse.test/jobs');
      await expect(connector.fetchJobs()).rejects.toThrow('Greenhouse API error (404)');
    });
  });

  describe('AshbyConnector', () => {
    it('should parse Ashby fixture into normalized RawJobPayload', async () => {
      const mockAshbyResponse = {
        jobs: [
          {
            id: 'ashby-uuid-99',
            title: 'Full Stack Engineer',
            jobUrl: 'https://jobs.ashbyhq.com/linear/ashby-uuid-99?utm_source=test',
            isRemote: true,
            location: 'Remote',
            department: 'Engineering',
            descriptionHtml: '<p>Build next-gen project management with React and TypeScript.</p>',
            publishedAt: '2026-09-15T08:00:00Z',
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockAshbyResponse,
      });

      const connector = new AshbyConnector('linear', 'Linear', 'http://mock-ashby.test/jobs');
      const jobs = await connector.fetchJobs();

      expect(jobs).toHaveLength(1);
      expect(jobs[0].externalId).toBe('ashby-uuid-99');
      expect(jobs[0].source).toBe('Ashby');
      expect(jobs[0].company).toBe('Linear');
      expect(jobs[0].url).toBe('https://jobs.ashbyhq.com/linear/ashby-uuid-99');
      expect(jobs[0].description).toBe('Build next-gen project management with React and TypeScript.');
    });
  });

  describe('ArbeitnowConnector', () => {
    it('should parse Arbeitnow payload correctly', async () => {
      const mockArbeitnowResponse = {
        data: [
          {
            slug: 'backend-engineer-node-123',
            company_name: 'Fintech AG',
            title: 'Node.js Backend Developer',
            url: 'https://www.arbeitnow.com/jobs/fintech-ag/backend-engineer-node-123',
            description: '<p>High throughput payment APIs with Node.js and PostgreSQL.</p>',
            remote: true,
            location: 'Remote',
            created_at: 1791739823,
            tags: ['Node.js', 'PostgreSQL'],
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockArbeitnowResponse,
      });

      const connector = new ArbeitnowConnector('http://mock-arbeitnow.test/jobs');
      const jobs = await connector.fetchJobs();

      expect(jobs).toHaveLength(1);
      expect(jobs[0].externalId).toBe('backend-engineer-node-123');
      expect(jobs[0].source).toBe('Arbeitnow');
      expect(jobs[0].company).toBe('Fintech AG');
      expect(jobs[0].tags).toContain('Node.js');
    });
  });
});
