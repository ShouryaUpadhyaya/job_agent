import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { allowedOrigins } from '../lib/origin';

describe('origin guard', () => {
  it('allows the dashboard origin and its loopback alias', async () => {
    const res = await request(app).get('/health').set('Origin', 'http://localhost:3000');
    expect(res.status).not.toBe(403);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');

    const alias = await request(app).get('/health').set('Origin', 'http://127.0.0.1:3000');
    expect(alias.status).not.toBe(403);
  });

  it('refuses other websites, including state-changing requests', async () => {
    const read = await request(app).get('/api/profiles').set('Origin', 'https://evil.example');
    expect(read.status).toBe(403);
    expect(read.headers['access-control-allow-origin']).toBeUndefined();

    const write = await request(app).post('/api/networking/contacts').set('Origin', 'https://evil.example').send({});
    expect(write.status).toBe(403);
  });

  it('allows requests without an Origin header (curl, scripts, OAuth redirects)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).not.toBe(403);
  });

  it('parses FRONTEND_URL lists', () => {
    expect(allowedOrigins({ FRONTEND_URL: 'http://localhost:3000/, https://jobs.example' } as NodeJS.ProcessEnv)).toEqual([
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://jobs.example',
    ]);
  });
});
