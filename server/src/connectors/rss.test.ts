import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RssConnector } from './rss';
import Parser from 'rss-parser';

vi.mock('rss-parser');

describe('RssConnector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse rss feed and map jobs correctly', async () => {
    const mockFeed = {
      items: [
        { guid: '123', title: 'Developer', creator: 'Company A', link: 'http://company.com/job/123' }
      ]
    };
    
    vi.mocked(Parser.prototype.parseURL).mockResolvedValue(mockFeed as any);

    const connector = new RssConnector('http://example.com/rss', (item: any) => ({
      id: item.guid,
      title: item.title,
      company: item.creator,
      url: item.link
    }));

    const jobs = await connector.fetchJobs();
    expect(Parser.prototype.parseURL).toHaveBeenCalledWith('http://example.com/rss');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual({
      id: '123',
      title: 'Developer',
      company: 'Company A',
      url: 'http://company.com/job/123'
    });
  });
});
