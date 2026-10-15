import { describe, it, expect, vi, afterEach } from 'vitest';
import { SmartRecruitersConnector } from '../connectors/smartrecruiters';
import { WorkableConnector } from '../connectors/workable';
import { RemotiveConnector } from '../connectors/remotive';
import { RemoteOkConnector } from '../connectors/remoteok';
import { ArbeitnowConnector } from '../connectors/arbeitnow';
import { JsonApiConnector } from '../connectors/jsonApi';
import { canonicalizeUrl, cleanHtml, isRestrictedHost } from '../connectors/utils';
import { createConnector, validateSourceToken, DEFAULT_SOURCES } from '../connectors/registry';

const json = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, statusText: status < 400 ? 'OK' : 'Error', json: async () => body } as Response);

function mockFetch(routes: Record<string, unknown>) {
  const fn = vi.fn((url: string) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return json({ error: 'not found' }, 404);
    return json(routes[key]);
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => vi.restoreAllMocks());

describe('utils', () => {
  it('keeps gh_jid (it is the job id on company-hosted Greenhouse boards) and strips trackers', () => {
    expect(canonicalizeUrl('https://razorpay.com/jobs/?gh_jid=123&utm_source=x&gh_src=y')).toBe('https://razorpay.com/jobs/?gh_jid=123');
  });

  it('decodes entity-escaped HTML', () => {
    expect(cleanHtml('&lt;p&gt;Hello &amp;amp; &lt;b&gt;bye&lt;/b&gt;&lt;/p&gt;')).toBe('Hello & bye');
  });

  it('flags LinkedIn/Naukri hosts as restricted', () => {
    expect(isRestrictedHost('https://in.linkedin.com/jobs/view/1')).toBe(true);
    expect(isRestrictedHost('https://www.naukri.com/job-listings-x-1')).toBe(true);
    expect(isRestrictedHost('https://boards.greenhouse.io/x')).toBe(false);
  });
});

describe('SmartRecruitersConnector', () => {
  it('pages postings, keeps tech roles and fetches details', async () => {
    const fetchFn = mockFetch({
      '/postings/111': {
        postingUrl: 'https://jobs.smartrecruiters.com/ACME/111-sde-intern',
        jobAd: { sections: { jobDescription: { text: '<p>Build APIs in Java.</p>' }, qualifications: { text: '<ul><li>DSA</li></ul>' } } },
      },
      '/postings/222': { jobAd: { sections: {} } },
      '/postings?limit=100&offset=0': {
        totalFound: 3,
        content: [
          { id: '111', name: 'SDE Intern', releasedDate: '2026-10-10T00:00:00Z', company: { identifier: 'ACME' }, location: { city: 'Bengaluru', country: 'in', fullLocation: 'Bengaluru, KA, India', hybrid: true }, function: { id: 'engineering' }, typeOfEmployment: { id: 'intern', label: 'Internship' }, experienceLevel: { id: 'internship', label: 'Internship' } },
          { id: '222', name: 'Backend Engineer', company: { identifier: 'ACME' }, location: { remote: true, city: 'Pune', country: 'in' }, function: { id: 'other' } },
          { id: '333', name: 'Sales Associate', company: { identifier: 'ACME' }, location: { city: 'Delhi', country: 'in' }, function: { id: 'sales' } },
        ],
      },
    });
    const jobs = await new SmartRecruitersConnector('Acme', 'Acme').fetchJobs();
    expect(jobs.map((j) => j.externalId).sort()).toEqual(['111', '222']);
    const intern = jobs.find((j) => j.externalId === '111')!;
    expect(intern).toMatchObject({
      source: 'smartrecruiters',
      company: 'Acme',
      url: 'https://jobs.smartrecruiters.com/ACME/111-sde-intern',
      location: 'Bengaluru, KA, India (Hybrid)',
      employmentType: 'INTERNSHIP',
    });
    expect(intern.description).toContain('Build APIs in Java.');
    expect(intern.publishedAt?.toISOString()).toBe('2026-10-10T00:00:00.000Z');
    expect(jobs.find((j) => j.externalId === '222')!.location).toContain('(Remote)');
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('throws on API errors', async () => {
    global.fetch = vi.fn(() => json({}, 404)) as unknown as typeof fetch;
    await expect(new SmartRecruitersConnector('Nope').fetchJobs()).rejects.toThrow('SmartRecruiters API error (404)');
  });
});

describe('WorkableConnector', () => {
  it('maps the widget API', async () => {
    mockFetch({
      'widget/accounts/acme': {
        name: 'Acme',
        jobs: [
          { title: 'Software Engineering Intern', shortcode: 'AB12', employment_type: 'Internship', telecommuting: true, url: 'https://apply.workable.com/j/AB12', published_on: '2026-10-01', city: 'Bengaluru', state: 'Karnataka', country: 'India', description: '<p>React and Node.js</p>', department: 'Engineering' },
        ],
      },
    });
    const [job] = await new WorkableConnector('acme').fetchJobs();
    expect(job).toMatchObject({
      externalId: 'AB12',
      source: 'workable',
      company: 'Acme',
      url: 'https://apply.workable.com/j/AB12',
      location: 'Bengaluru, Karnataka, India (Remote)',
      employmentType: 'INTERNSHIP',
      description: 'React and Node.js',
    });
  });
});

describe('RemotiveConnector', () => {
  it('maps jobs, keeps the Remotive URL and tags attribution', async () => {
    const fetchFn = mockFetch({
      'remotive.com/api/remote-jobs': {
        '0-legal-notice': 'link back please',
        jobs: [{ id: 99, url: 'https://remotive.com/remote-jobs/software-dev/x-99', title: 'Junior Developer', company_name: 'Remote Co', tags: ['react'], job_type: 'internship', publication_date: '2026-10-11T20:17:27', candidate_required_location: 'Worldwide', description: '<p>Hi</p>' }],
      },
    });
    const connector = new RemotiveConnector();
    const [job] = await connector.fetchJobs();
    expect(fetchFn.mock.calls[0][0]).toContain('category=software-dev');
    expect(job).toMatchObject({ externalId: '99', source: 'remotive', url: 'https://remotive.com/remote-jobs/software-dev/x-99', location: 'Remote (Worldwide)', employmentType: 'INTERNSHIP' });
    expect(job.tags).toContain('via Remotive');
    expect(connector.minIntervalMs).toBeGreaterThanOrEqual(6 * 3600 * 1000);
  });
});

describe('RemoteOkConnector', () => {
  it('skips the legal notice element, keeps dev jobs and tags attribution', async () => {
    mockFetch({
      'remoteok.com/api': [
        { last_updated: 1, legal: 'API Terms of Service: link back' },
        { id: '1', slug: 'dev-1', position: 'Backend Engineer', company: 'Okay Inc', tags: ['dev', 'golang'], date: '2026-10-14T01:31:49+00:00', url: 'https://remoteOK.com/remote-jobs/dev-1', location: 'India', description: 'Go' },
        { id: '2', position: 'Support Specialist', company: 'Help Co', tags: ['customer support'], url: 'https://remoteOK.com/remote-jobs/2' },
      ],
    });
    const jobs = await new RemoteOkConnector().fetchJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ externalId: '1', source: 'remoteok', location: 'Remote (India)' });
    expect(jobs[0].tags).toContain('via Remote OK');
  });
});

describe('ArbeitnowConnector', () => {
  it('follows pagination and uses stable ids', async () => {
    const page = (n: number, next: string | null) => ({
      data: [{ slug: `job-${n}`, title: `Dev ${n}`, company_name: 'A', url: `https://www.arbeitnow.com/jobs/job-${n}`, remote: true, created_at: 1790000000 }],
      links: { next },
    });
    global.fetch = vi.fn((url: string) =>
      json(url.includes('page=2') ? page(2, null) : page(1, 'https://www.arbeitnow.com/api/job-board-api?page=2'))
    ) as unknown as typeof fetch;
    const jobs = await new ArbeitnowConnector().fetchJobs();
    expect(jobs.map((j) => j.externalId)).toEqual(['job-1', 'job-2']);

    global.fetch = vi.fn(() => json({ data: [{ title: 'No slug', url: 'https://example.com/x' }], links: {} })) as unknown as typeof fetch;
    const [a] = await new ArbeitnowConnector().fetchJobs();
    const [b] = await new ArbeitnowConnector().fetchJobs();
    expect(a.externalId).toBe(b.externalId);
  });
});

describe('JsonApiConnector default mapper', () => {
  it('maps common JSON shapes', async () => {
    mockFetch({ 'feed.example': { jobs: [{ id: 7, title: 'Intern', company_name: 'Feed Co', url: 'https://feed.example/7', description: '<b>x</b>', published_at: '2026-10-01' }] } });
    const jobs: any[] = await new JsonApiConnector('https://feed.example/jobs.json').fetchJobs();
    expect(jobs[0]).toMatchObject({ externalId: '7', source: 'jsonapi', company: 'Feed Co', description: 'x' });
  });
});

describe('registry', () => {
  it('creates connectors for supported types and none for LinkedIn/Wellfound', () => {
    expect(createConnector({ sourceType: 'smartrecruiters', boardToken: 'Freshworks', name: 'Freshworks' })?.source).toBe('smartrecruiters');
    expect(createConnector({ sourceType: 'rss', boardToken: 'https://example.com/feed', name: 'Feed' })?.source).toBe('rss');
    expect(createConnector({ sourceType: 'rss', boardToken: 'https://www.linkedin.com/jobs/rss', name: 'x' })).toBeNull();
    expect(createConnector({ sourceType: 'linkedin', boardToken: 'x', name: 'x' })).toBeNull();
    expect(createConnector({ sourceType: 'wellfound', boardToken: 'x', name: 'x' })).toBeNull();
  });

  it('validates tokens', () => {
    expect(validateSourceToken('greenhouse', '')).toMatch(/needs/);
    expect(validateSourceToken('greenhouse', 'bad token!')).toMatch(/only contain/);
    expect(validateSourceToken('jsonapi', 'ftp://x')).toMatch(/http/);
    expect(validateSourceToken('rss', 'https://naukri.com/feed')).toMatch(/terms/);
    expect(validateSourceToken('smartrecruiters', 'Freshworks')).toBeNull();
  });

  it('has no duplicate or LinkedIn/Wellfound defaults', () => {
    const keys = DEFAULT_SOURCES.map((d) => `${d.sourceType}:${d.boardToken.toLowerCase()}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(DEFAULT_SOURCES.some((d) => ['linkedin', 'wellfound'].includes(d.sourceType))).toBe(false);
    expect(DEFAULT_SOURCES.length).toBeGreaterThanOrEqual(25);
  });
});
