import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from 'vitest';
import request from 'supertest';

const g = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  getToken: vi.fn(),
  userinfo: vi.fn(),
  revoke: vi.fn(),
  tokenListeners: [] as ((t: any) => void)[],
}));

vi.mock('googleapis', () => {
  class OAuth2 {
    constructor(public id: string, public secret: string, public redirect: string) {}
    generateAuthUrl(opts: any) {
      return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${this.id}&scope=${encodeURIComponent(opts.scope.join(' '))}&state=${opts.state}`;
    }
    getToken(code: string) {
      return g.getToken(code);
    }
    setCredentials() {}
    on(ev: string, fn: any) {
      if (ev === 'tokens') g.tokenListeners.push(fn);
      return this;
    }
    revokeToken(t: string) {
      return g.revoke(t);
    }
  }
  return {
    google: {
      auth: { OAuth2 },
      gmail: () => ({ users: { messages: { list: g.list, get: g.get } } }),
      oauth2: () => ({ userinfo: { get: g.userinfo } }),
    },
  };
});

vi.mock('../discovery/jobAlerts', () => ({
  ingestJobAlertEmail: vi.fn(async () => ({ parsed: 3, created: 2, updated: 1, jobIds: [] })),
}));

vi.mock('../lib/gemini', async (orig) => {
  const actual = await orig<typeof import('../lib/gemini')>();
  return { ...actual, generateText: vi.fn(async () => null) };
});

import { app } from '../app';
import { prisma } from '../db';
import { gmailService } from '../email/service';
import { ingestJobAlertEmail } from '../discovery/jobAlerts';
import { companyKey } from '../lib/company';

const enc = (s: string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const DAY = 24 * 3600 * 1000;

function gmailMessage(id: string, m: { from: string; subject: string; body: string; at: Date }) {
  return {
    data: {
      id,
      threadId: `t-${id}`,
      snippet: m.body.slice(0, 80),
      internalDate: String(m.at.getTime()),
      payload: {
        mimeType: 'multipart/alternative',
        headers: [
          { name: 'From', value: m.from },
          { name: 'Subject', value: m.subject },
          { name: 'Date', value: m.at.toUTCString() },
        ],
        parts: [
          { mimeType: 'text/plain', body: { data: enc(m.body) } },
          { mimeType: 'text/html', body: { data: enc(`<p>${m.body}</p>`) } },
        ],
      },
    },
  };
}

async function wipe() {
  await prisma.emailEvent.deleteMany();
  await prisma.networkingMessage.deleteMany();
  await prisma.networkingContact.deleteMany();
  await prisma.document.deleteMany();
  await prisma.jobApplication.deleteMany();
  await prisma.resume.deleteMany();
  await prisma.candidateProfile.deleteMany();
  await prisma.jobListing.deleteMany();
  await prisma.connectedAccount.deleteMany();
}

let profileId: string;

async function makeApp(company: string, title: string, stage = 'APPLIED') {
  const key = companyKey(company);
  const job = await prisma.jobListing.create({
    data: { externalId: `${key}-${title}`, source: 'greenhouse', title, company, companyKey: key, url: `https://x/${key}`, description: '' },
  });
  return prisma.jobApplication.create({ data: { jobListingId: job.id, candidateProfileId: profileId, stage, status: 'SUBMITTED', companyKey: key } });
}

async function connectedAccount(extra: Record<string, unknown> = {}) {
  return prisma.connectedAccount.create({
    data: { provider: 'gmail', email: 'me@gmail.com', accessToken: 'at', refreshToken: 'rt', status: 'CONNECTED', scopes: [], ...extra },
  });
}

beforeAll(() => {
  process.env.GMAIL_CLIENT_ID = 'cid.apps.googleusercontent.com';
  process.env.GMAIL_CLIENT_SECRET = 'secret';
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

beforeEach(async () => {
  for (const f of [g.list, g.get, g.getToken, g.userinfo, g.revoke]) f.mockReset();
  g.tokenListeners.length = 0;
  vi.mocked(ingestJobAlertEmail).mockClear();
  await wipe();
  profileId = (await prisma.candidateProfile.create({ data: { name: 'Shourya U', targetGradYear: 2028, skills: [] } })).id;
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('configuration and OAuth', () => {
  it('reports configured:false with setup steps when credentials are missing', async () => {
    const saved = process.env.GMAIL_CLIENT_ID;
    delete process.env.GMAIL_CLIENT_ID;
    try {
      const s = await request(app).get('/api/gmail/status');
      expect(s.body.configured).toBe(false);
      expect(s.body.missingEnv).toContain('GMAIL_CLIENT_ID');
      expect(s.body.setup.join(' ')).toContain('Gmail API');
      const u = await request(app).get('/api/gmail/auth-url');
      expect(u.status).toBe(400);
      expect(u.body.code).toBe('not_configured');
      const sync = await request(app).post('/api/gmail/sync');
      expect(sync.status).toBe(400);
    } finally {
      process.env.GMAIL_CLIENT_ID = saved;
    }
  });

  it('accepts the legacy GOOGLE_* names', async () => {
    const saved = process.env.GMAIL_CLIENT_ID;
    delete process.env.GMAIL_CLIENT_ID;
    process.env.GOOGLE_CLIENT_ID = 'legacy-id';
    try {
      const u = await request(app).get('/api/gmail/auth-url');
      expect(u.body.url).toContain('client_id=legacy-id');
    } finally {
      process.env.GMAIL_CLIENT_ID = saved;
      delete process.env.GOOGLE_CLIENT_ID;
    }
  });

  it('issues a state, rejects unknown states, and keeps the refresh token on re-consent', async () => {
    const u = await request(app).get('/api/gmail/auth-url');
    expect(u.body.url).toContain('gmail.readonly');
    const state = new URL(u.body.url).searchParams.get('state')!;
    expect(state).toMatch(/^[a-f0-9]{48}$/);

    const bad = await request(app).get('/api/gmail/oauth2callback?code=c&state=forged');
    expect(bad.status).toBe(302);
    expect(bad.headers.location).toContain('auth=error');
    expect(g.getToken).not.toHaveBeenCalled();

    g.getToken.mockResolvedValue({ tokens: { access_token: 'a1', refresh_token: 'r1', expiry_date: Date.now() + 3600e3, scope: 'https://www.googleapis.com/auth/gmail.readonly' } });
    g.userinfo.mockResolvedValue({ data: { email: 'me@gmail.com', name: 'Me' } });
    const ok = await request(app).get(`/api/gmail/oauth2callback?code=c&state=${state}`);
    expect(ok.headers.location).toMatch(/tab=GMAIL&auth=success/);
    // single use
    const replay = await request(app).get(`/api/gmail/oauth2callback?code=c&state=${state}`);
    expect(replay.headers.location).toContain('auth=error');

    const state2 = new URL((await request(app).get('/api/gmail/auth-url')).body.url).searchParams.get('state')!;
    g.getToken.mockResolvedValue({ tokens: { access_token: 'a2', scope: 'https://www.googleapis.com/auth/gmail.readonly' } });
    await request(app).get(`/api/gmail/oauth2callback?code=c&state=${state2}`);
    const acct = await prisma.connectedAccount.findFirst();
    expect(acct?.accessToken).toBe('a2');
    expect(acct?.refreshToken).toBe('r1');
    expect(acct?.lastSyncedAt).toBeNull();
  });

  it('disconnect revokes and clears every account', async () => {
    await connectedAccount();
    await prisma.connectedAccount.create({ data: { provider: 'gmail', email: 'old@gmail.com', refreshToken: 'old', status: 'EXPIRED', scopes: [] } });
    g.revoke.mockResolvedValue({});
    const res = await request(app).post('/api/gmail/disconnect');
    expect(res.body).toMatchObject({ accounts: 2, revoked: 2 });
    const rows = await prisma.connectedAccount.findMany();
    expect(rows.every((r) => r.status === 'DISCONNECTED' && !r.refreshToken && !r.accessToken)).toBe(true);
  });
});

describe('sync', () => {
  const now = new Date();
  const msgs = {
    m1: gmailMessage('m1', { from: '"Razorpay" <no-reply@us.greenhouse-mail.io>', subject: 'Thank you for applying to Razorpay', body: 'We have received your application for the SDE Intern role at Razorpay.', at: new Date(now.getTime() - 3 * DAY) }),
    m2: gmailMessage('m2', { from: 'Ananya <ananya@razorpay.com>', subject: 'Interview invitation - SDE Intern at Razorpay', body: 'We would like to schedule an interview. Please share your availability within 48 hours.', at: new Date(now.getTime() - 1 * DAY) }),
    m3: gmailMessage('m3', { from: 'Stripe <no-reply@us.greenhouse-mail.io>', subject: 'Update on your application to Stripe', body: 'Unfortunately, we have decided to move forward with other candidates.', at: new Date(now.getTime() - 2 * DAY) }),
  };

  function serve(pages: string[][]) {
    g.list.mockImplementation(async ({ pageToken }: any) => {
      const i = pageToken ? Number(pageToken) : 0;
      return { data: { messages: pages[i].map((id) => ({ id })), nextPageToken: i + 1 < pages.length ? String(i + 1) : undefined } };
    });
    g.get.mockImplementation(async ({ id }: any) => (msgs as any)[id]);
  }

  it('is incremental, paginated, oldest-first and idempotent', async () => {
    await connectedAccount();
    await makeApp('Stripe', 'Software Engineering Intern');
    serve([['m2', 'm3'], ['m1']]); // Gmail lists newest first

    const first = await request(app).post('/api/gmail/sync');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ fetched: 3, new: 3, skipped: 0, errors: 0, applicationsCreated: 1, stageChanges: 2 });
    const q: string = g.list.mock.calls[0][0].q;
    expect(q).toMatch(/^after:\d+/);
    const afterEpoch = Number(q.match(/after:(\d+)/)![1]) * 1000;
    expect(Math.round((now.getTime() - afterEpoch) / DAY)).toBe(60);

    // The confirmation (oldest) created the application before the interview moved it.
    const razorpay = await prisma.jobApplication.findFirst({ where: { companyKey: 'razorpay' }, include: { jobListing: true } });
    expect(razorpay).toMatchObject({ stage: 'INTERVIEWING', source: 'email' });
    expect(razorpay?.jobListing.source).toBe('email');
    expect(razorpay?.jobListing.externalId).toBe('email-m1');
    expect(razorpay?.lastEmailAt?.getTime()).toBe(msgs.m2.data.internalDate ? Number(msgs.m2.data.internalDate) : 0);
    const stripe = await prisma.jobApplication.findFirst({ where: { companyKey: 'stripe' } });
    expect(stripe?.stage).toBe('REJECTED');

    const events = await prisma.emailEvent.findMany({ orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => e.messageId)).toEqual(['m1', 'm3', 'm2']);
    expect(events[2].body).toContain('availability within 48 hours');
    expect(events[2].senderName).toBe('Ananya');

    const status = (await request(app).get('/api/gmail/status')).body;
    expect(status.lastSync).toMatchObject({ fetched: 3, new: 3 });
    expect(status.lastError).toBeNull();

    // Re-sync: nothing new is fetched or re-applied.
    await prisma.jobApplication.update({ where: { id: razorpay!.id }, data: { stage: 'APPLIED' } });
    g.get.mockClear();
    const second = await request(app).post('/api/gmail/sync');
    expect(second.body).toMatchObject({ fetched: 3, new: 0, skipped: 3 });
    expect(g.get).not.toHaveBeenCalled();
    expect((await prisma.jobApplication.findUnique({ where: { id: razorpay!.id } }))?.stage).toBe('APPLIED');
    const q2: string = g.list.mock.calls.at(-1)![0].q;
    const after2 = Number(q2.match(/after:(\d+)/)![1]) * 1000;
    expect(Math.round((Date.now() - after2) / DAY)).toBe(1);
  });

  it('runs one sync at a time: a concurrent call gets 409 sync_in_progress', async () => {
    await connectedAccount();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    g.list.mockImplementation(async () => {
      await gate;
      return { data: { messages: [] } };
    });
    const first = gmailService.syncInbox();
    expect(gmailService.isSyncing()).toBe(true);
    const second = await request(app).post('/api/gmail/sync');
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('sync_in_progress');
    release();
    await first;
    expect(gmailService.isSyncing()).toBe(false);
  });

  it('caps a run and resumes from the newest processed message', async () => {
    process.env.GMAIL_SYNC_MAX_MESSAGES = '2';
    try {
      await connectedAccount();
      serve([['m2', 'm3', 'm1']]);
      const r = await gmailService.syncInbox();
      expect(r.new).toBe(2);
      expect(r.remaining).toBe(1);
      expect((await prisma.emailEvent.findMany()).map((e) => e.messageId).sort()).toEqual(['m1', 'm3']);
      const r2 = await gmailService.syncInbox();
      expect(r2.new).toBe(1);
      expect(r2.remaining).toBe(0);
    } finally {
      delete process.env.GMAIL_SYNC_MAX_MESSAGES;
    }
  });

  it('isolates per-message failures', async () => {
    await connectedAccount();
    serve([['m2', 'm1']]);
    g.get.mockImplementation(async ({ id }: any) => {
      if (id === 'm2') throw Object.assign(new Error('Backend Error'), { response: { status: 500, data: { error: { message: 'Backend Error' } } } });
      return (msgs as any)[id];
    });
    const r = await gmailService.syncInbox();
    expect(r).toMatchObject({ new: 1, errors: 1 });
  });

  it('marks the account EXPIRED on invalid_grant and never inserts demo data', async () => {
    await connectedAccount();
    await makeApp('Cloudflare', 'Systems Engineer Intern');
    g.list.mockRejectedValue(Object.assign(new Error('invalid_grant'), { response: { status: 400, data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } } }));
    const res = await request(app).post('/api/gmail/sync');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_grant');
    expect(res.body.fix).toMatch(/Reconnect/);
    expect(await prisma.emailEvent.count()).toBe(0);
    expect((await prisma.jobApplication.findFirst())?.stage).toBe('APPLIED');
    const acct = await prisma.connectedAccount.findFirst();
    expect(acct?.status).toBe('EXPIRED');
    const status = (await request(app).get('/api/gmail/status')).body;
    expect(status).toMatchObject({ connected: false, accountStatus: 'EXPIRED' });
    expect(status.lastError.code).toBe('invalid_grant');
  });

  it('records other API errors without expiring the account', async () => {
    await connectedAccount();
    g.list.mockRejectedValue(Object.assign(new Error('Gmail API has not been used in project 123 before or it is disabled.'), { response: { status: 403, data: {} } }));
    const res = await request(app).post('/api/gmail/sync');
    expect(res.status).toBe(502);
    expect(res.body.fix).toMatch(/Enable the Gmail API/);
    expect((await prisma.connectedAccount.findFirst())?.status).toBe('CONNECTED');
  });

  it('persists refreshed tokens', async () => {
    const acct = await connectedAccount();
    serve([[]]);
    await gmailService.syncInbox();
    expect(g.tokenListeners.length).toBeGreaterThan(0);
    g.tokenListeners[0]({ access_token: 'fresh', expiry_date: Date.now() + 3600e3 });
    await new Promise((r) => setTimeout(r, 100));
    const row = await prisma.connectedAccount.findUnique({ where: { id: acct.id } });
    expect(row?.accessToken).toBe('fresh');
    expect(row?.refreshToken).toBe('rt');
  });
});

describe('effects', () => {
  const at = new Date();
  const proc = (id: string, sender: string, subject: string, body: string, senderName?: string) =>
    gmailService.processEmail({ messageId: id, sender, senderName, subject, body, receivedAt: at });

  it('never moves an application out of REJECTED or OFFERED', async () => {
    const rejected = await makeApp('Cloudflare', 'Systems Intern', 'REJECTED');
    const r1 = await proc('e1', 'recruiting@cloudflare.com', 'Invitation to interview at Cloudflare', 'Please pick a time for your technical interview.');
    expect(r1.event.jobApplicationId).toBe(rejected.id);
    expect((await prisma.jobApplication.findUnique({ where: { id: rejected.id } }))?.stage).toBe('REJECTED');
    const r2 = await proc('e2', 'recruiting@cloudflare.com', 'Offer letter', 'We are pleased to offer you the position at Cloudflare.');
    expect(r2.event.classification).toBe('OFFER');
    expect((await prisma.jobApplication.findUnique({ where: { id: rejected.id } }))?.stage).toBe('REJECTED');
    expect((await prisma.jobApplication.findUnique({ where: { id: rejected.id } }))?.lastEmailAt).not.toBeNull();
  });

  it('matches by companyKey and role, not substring', async () => {
    await makeApp('Meta Labs', 'Data Analyst');
    const backend = await makeApp('Razorpay Software Pvt Ltd', 'Backend Engineer Intern');
    const frontend = await makeApp('Razorpay', 'Frontend Engineer Intern');
    const r = await proc('e3', 'no-reply@us.greenhouse-mail.io', 'Interview invitation: Backend Engineer Intern at Razorpay', 'Schedule your technical interview here.');
    expect(r.event.jobApplicationId).toBe(backend.id);
    expect((await prisma.jobApplication.findUnique({ where: { id: backend.id } }))?.stage).toBe('INTERVIEWING');
    expect((await prisma.jobApplication.findUnique({ where: { id: frontend.id } }))?.stage).toBe('APPLIED');
  });

  it('writes the same audit entries as manual edits for stage changes and created applications', async () => {
    const a = await makeApp('Postman', 'Backend Intern');
    await proc('e-audit-1', 'no-reply@us.greenhouse-mail.io', 'Interview invitation: Backend Intern at Postman', 'Schedule your technical interview here.');
    const updates = await prisma.auditLog.findMany({ where: { entityId: a.id, action: 'JOB_APPLICATION_UPDATED' } });
    expect(updates).toHaveLength(1);
    expect(updates[0].metadata).toEqual({ changes: { stage: 'INTERVIEWING' }, from: { stage: 'APPLIED' }, source: 'email' });

    const r = await proc('e-audit-2', 'no-reply@us.greenhouse-mail.io', 'Thank you for applying to Atlassian', 'We have received your application for the Software Engineer Intern role at Atlassian.');
    expect(r.event.classification).toBe('APPLICATION_CONFIRMATION');
    const created = await prisma.auditLog.findMany({ where: { entityId: r.event.jobApplicationId!, action: 'JOB_APPLICATION_CREATED' } });
    expect(created).toHaveLength(1);
    expect(created[0].metadata).toMatchObject({ stage: 'APPLIED', source: 'email' });
  });

  it('assessment keeps the stage and adds a dated note', async () => {
    const a = await makeApp('Swiggy', 'SDE Intern');
    await proc('e4', 'support@hackerrankforwork.com', 'Swiggy SDE Intern assessment', 'Swiggy has invited you to take the online assessment. Complete it within 72 hours.', 'HackerRank');
    const after = await prisma.jobApplication.findUnique({ where: { id: a.id } });
    expect(after?.stage).toBe('APPLIED');
    expect(after?.notes).toMatch(/Assessment invite.*within 72 hours/);
    expect((await prisma.emailEvent.findUnique({ where: { messageId: 'e4' } }))?.importance).toBe('HIGH');
  });

  it('LinkedIn accept: ACCEPTED + referral draft when a job is linked, no draft otherwise', async () => {
    const job = await prisma.jobListing.create({ data: { externalId: 'rp-1', source: 'greenhouse', title: 'SDE Intern', company: 'Razorpay', companyKey: 'razorpay', url: 'https://jobs/rp', description: '' } });
    const withJob = await prisma.networkingContact.create({ data: { name: 'Priya Sharma', company: 'Razorpay', companyKey: 'razorpay', role: 'SDE-2', status: 'REQUEST_SENT', targetJobId: job.id } });
    await prisma.networkingContact.create({ data: { name: 'Priya Sharma', company: 'Zomato', companyKey: 'zomato', role: 'SDE', status: 'REQUEST_SENT' } });
    const r = await proc('e5', 'invitations@linkedin.com', 'Priya Sharma accepted your invitation', 'Priya Sharma\nSDE-2 at Razorpay\nPriya Sharma has accepted your invitation.');
    expect(r.event.networkingContactId).toBe(withJob.id);
    const c = await prisma.networkingContact.findUnique({ where: { id: withJob.id }, include: { messages: true } });
    expect(c?.status).toBe('ACCEPTED');
    expect(c?.messages.map((m) => m.type)).toEqual(['REFERRAL_ASK']);

    const noJob = await prisma.networkingContact.create({ data: { name: 'Arjun Das', company: 'Groww', companyKey: 'groww', role: 'SDE', status: 'REQUEST_SENT' } });
    const r2 = await proc('e6', 'invitations@linkedin.com', 'Arjun Das accepted your invitation', 'Arjun Das has accepted your invitation.');
    expect(r2.event.networkingContactId).toBe(noJob.id);
    expect(r2.event.explanation).toMatch(/Link a job/);
    expect(await prisma.networkingMessage.count({ where: { contactId: noJob.id } })).toBe(0);
  });

  it('recruiter outreach creates a GMAIL contact; no-reply senders never do', async () => {
    const r = await proc('e7', 'rohan.mehta@juspay.in', 'Backend internship opportunity at Juspay', 'I came across your profile and think you might be a great fit.', 'Rohan Mehta');
    const contact = await prisma.networkingContact.findUnique({ where: { id: r.event.networkingContactId! } });
    expect(contact).toMatchObject({ name: 'Rohan Mehta', company: 'Juspay', source: 'GMAIL', email: 'rohan.mehta@juspay.in', emailSource: 'gmail', persona: 'RECRUITER' });
    // Second email from the same person links to the same contact.
    const r2 = await proc('e8', 'rohan.mehta@juspay.in', 'Re: Backend internship opportunity at Juspay', 'Following up — please share your resume.', 'Rohan Mehta');
    expect(r2.event.networkingContactId).toBe(contact!.id);
    expect(await prisma.networkingContact.count()).toBe(1);

    await proc('e9', 'no-reply@talent.example.com', 'Exciting opportunity at Example', 'We came across your profile and think you might be a great fit.', 'Example Talent');
    expect(await prisma.networkingContact.count()).toBe(1);
  });

  it('job alerts go to discovery ingestion', async () => {
    const r = await proc('e10', 'jobalerts-noreply@linkedin.com', '“backend intern”: 12 new jobs', 'Razorpay - Backend Intern', 'LinkedIn Job Alerts');
    expect(r.event.classification).toBe('JOB_ALERT');
    expect(ingestJobAlertEmail).toHaveBeenCalledTimes(1);
    expect(r.event.explanation).toMatch(/2 new and 1 updated/);
  });
});

describe('demo, events and summary', () => {
  it('demo events are flagged, side-effect free and excluded by default', async () => {
    const a = await makeApp('Placeholder Inc', 'SWE Intern');
    const res = await request(app).post('/api/gmail/demo');
    expect(res.status).toBe(201);
    expect(res.body.created).toBeGreaterThan(0);
    expect((await prisma.jobApplication.findUnique({ where: { id: a.id } }))?.stage).toBe('APPLIED');
    const demos = await prisma.emailEvent.findMany();
    expect(demos.every((e) => e.isDemo && !e.jobApplicationId && !e.networkingContactId)).toBe(true);

    expect((await request(app).get('/api/gmail/events')).body).toHaveLength(0);
    expect((await request(app).get('/api/gmail/events?demo=include')).body.length).toBe(demos.length);
    expect((await request(app).get('/api/gmail/summary')).body.totalEvents).toBe(0);
    expect((await request(app).get('/api/gmail/status')).body).toMatchObject({ totalEventsTracked: 0, demoEvents: demos.length });

    const sim = await request(app).post('/api/gmail/simulate').send({ sender: 'jobs@uber.com', subject: 'Uber: Application received', snippet: 'Thank you for applying to Uber.' });
    expect(sim.status).toBe(201);
    expect(sim.body.event.isDemo).toBe(true);

    const cleared = await request(app).delete('/api/gmail/demo');
    expect(cleared.body.deleted).toBe(demos.length + 1);
  });

  it('classify preview stores nothing', async () => {
    const r = await request(app).post('/api/gmail/classify').send({ sender: 'no-reply@ashbyhq.com', subject: 'Zepto | Application received', body: 'Thanks for applying to Zepto.' });
    expect(r.body).toMatchObject({ classification: 'APPLICATION_CONFIRMATION', company: 'Zepto' });
    expect(await prisma.emailEvent.count()).toBe(0);
  });

  it('events: filters and a bad limit do not 500', async () => {
    const a = await makeApp('Stripe', 'SWE Intern');
    await gmailService.processEmail({ messageId: 'x1', sender: 'no-reply@greenhouse.io', senderName: 'Stripe', subject: 'Update on your application to Stripe', body: 'Unfortunately we will not be moving forward.' });
    await gmailService.processEmail({ messageId: 'x2', sender: 'jobalerts-noreply@linkedin.com', subject: 'Jobs for you', body: 'x' });
    const bad = await request(app).get('/api/gmail/events?limit=abc');
    expect(bad.status).toBe(200);
    expect(bad.body).toHaveLength(2);
    expect(bad.body[0].body).toBeUndefined();
    expect((await request(app).get('/api/gmail/events?linked=linked')).body.map((e: any) => e.jobApplication?.id)).toEqual([a.id]);
    expect((await request(app).get('/api/gmail/events?linked=unlinked')).body.map((e: any) => e.messageId)).toEqual(['x2']);
    const x2 = await prisma.emailEvent.findUnique({ where: { messageId: 'x2' } });
    expect((await request(app).get(`/api/gmail/events?id=${x2!.id}`)).body.map((e: any) => e.messageId)).toEqual(['x2']);
    expect((await request(app).get('/api/gmail/events?importance=LOW')).body.map((e: any) => e.messageId)).toEqual(['x2']);
    expect((await request(app).get('/api/gmail/events?classification=REJECTION')).body).toHaveLength(1);
    expect((await request(app).get('/api/gmail/events?classification=NOPE')).status).toBe(400);
  });

  it('summary lists needs-action items with deadlines and stage changes', async () => {
    const a = await makeApp('CRED', 'Backend Engineer Intern');
    await gmailService.processEmail({
      messageId: 's1',
      sender: 'ananya.rao@cred.club',
      senderName: 'Ananya Rao',
      subject: 'Interview invitation - Backend Engineer Intern at CRED',
      body: 'We would like to schedule a technical interview. Please share your availability within 48 hours.',
    });
    await gmailService.processEmail({ messageId: 's2', sender: 'rohan@juspay.in', senderName: 'Rohan Mehta', subject: 'Opportunity at Juspay', body: 'I came across your profile and think you might be a great fit.' });
    await gmailService.processEmail({ messageId: 's3', sender: 'jobalerts-noreply@linkedin.com', subject: 'New jobs for you', body: 'x' });
    await gmailService.loadDemo();

    const s = (await request(app).get('/api/gmail/summary?days=7')).body;
    expect(s.totalEvents).toBe(3);
    expect(s.counts).toMatchObject({ INTERVIEW_INVITATION: 1, RECRUITER_OUTREACH: 1, JOB_ALERT: 1 });
    expect(s.needsAction[0]).toMatchObject({ kind: 'INTERVIEW', deadline: 'within 48 hours', link: `?tab=PIPELINE&id=${a.id}` });
    expect(s.needsAction[0].application.id).toBe(a.id);
    expect(s.needsAction[1]).toMatchObject({ kind: 'RECRUITER_REPLY', link: `?tab=NETWORKING&id=${s.needsAction[1].contact.id}` });
    expect(s.statusChanges).toEqual([expect.objectContaining({ applicationId: a.id, from: 'APPLIED', to: 'INTERVIEWING' })]);
    expect(s.highlights.length).toBeGreaterThan(0);
    expect(s.aiSummary).toBeNull();
    expect((await request(app).get('/api/gmail/summary?days=abc')).body.days).toBe(7);
  });
});
