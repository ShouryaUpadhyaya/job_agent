/**
 * Finds people at a company through GitHub's public REST API (allowed by the project rules,
 * unlike LinkedIn). Only fields people published on their GitHub profile are returned —
 * nothing is inferred or guessed. Responses are cached in memory for an hour and each lookup
 * makes a bounded number of requests. Set GITHUB_TOKEN to raise the rate limit.
 */
import { companyKey } from '../lib/company';

const API = 'https://api.github.com';
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_LOOKUP = 25;
const MAX_PEOPLE = 15;

export interface GithubOrg {
  login: string;
  name: string | null;
  htmlUrl: string;
  avatarUrl: string | null;
  blog: string | null;
  description: string | null;
}

export interface GithubPerson {
  login: string;
  name: string | null;
  htmlUrl: string;
  avatarUrl: string | null;
  blog: string | null;
  twitterUsername: string | null;
  company: string | null;
  bio: string | null;
  /** Only set when the person published it on their GitHub profile. */
  email: string | null;
  location: string | null;
  via: 'member' | 'contributor';
  /** Their GitHub "company" field names the target company or org. */
  companyMatches: boolean;
  contributions?: number;
}

export interface GithubPeopleResult {
  org: GithubOrg | null;
  orgCandidates: { login: string; htmlUrl: string; avatarUrl: string | null }[];
  people: GithubPerson[];
  source: 'members' | 'contributors' | 'none';
  rateLimited: boolean;
  rateLimitResetAt: string | null;
  message: string | null;
}

class RateLimitError extends Error {
  constructor(public resetAt: string | null) {
    super('GitHub API rate limit reached');
  }
}

class RequestBudgetError extends Error {}

const cache = new Map<string, { expires: number; value: unknown }>();

export function clearGithubCache() {
  cache.clear();
}

class GithubClient {
  private used = 0;
  constructor(private budget = MAX_REQUESTS_PER_LOOKUP) {}

  async get<T>(path: string): Promise<T | null> {
    const hit = cache.get(path);
    if (hit && hit.expires > Date.now()) return hit.value as T;
    if (this.used >= this.budget) throw new RequestBudgetError('request budget used');
    this.used++;

    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'job-agent-networking',
    };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(`${API}${path}`, { headers, signal: controller.signal });
      if (res.status === 404) {
        cache.set(path, { expires: Date.now() + CACHE_TTL_MS, value: null });
        return null;
      }
      if (res.status === 403 || res.status === 429) {
        const remaining = res.headers.get('x-ratelimit-remaining');
        const reset = res.headers.get('x-ratelimit-reset');
        if (remaining === '0' || res.status === 429) {
          throw new RateLimitError(reset ? new Date(Number(reset) * 1000).toISOString() : null);
        }
        return null;
      }
      if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path}`);
      const data = (await res.json()) as T;
      cache.set(path, { expires: Date.now() + CACHE_TTL_MS, value: data });
      return data;
    } finally {
      clearTimeout(timer);
    }
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function toOrg(o: any): GithubOrg {
  return {
    login: o.login,
    name: str(o.name),
    htmlUrl: o.html_url || `https://github.com/${o.login}`,
    avatarUrl: str(o.avatar_url),
    blog: str(o.blog),
    description: str(o.description),
  };
}

function toPerson(u: any, via: GithubPerson['via'], target: { key: string; org: string }, contributions?: number): GithubPerson {
  const company = str(u.company);
  const companyText = (company || '').toLowerCase();
  const companyMatches = Boolean(
    company &&
      ((target.key && companyKey(company.replace(/^@/, '')) === target.key) ||
        companyText.includes(`@${target.org.toLowerCase()}`) ||
        companyText.replace(/^@/, '') === target.org.toLowerCase())
  );
  return {
    login: u.login,
    name: str(u.name),
    htmlUrl: u.html_url || `https://github.com/${u.login}`,
    avatarUrl: str(u.avatar_url),
    blog: str(u.blog),
    twitterUsername: str(u.twitter_username),
    company,
    bio: str(u.bio),
    email: str(u.email),
    location: str(u.location),
    via,
    companyMatches,
    ...(contributions !== undefined ? { contributions } : {}),
  };
}

/** Picks the org whose login or name best matches the company. */
function pickOrg(company: string, candidates: { login: string }[]): string | null {
  const key = companyKey(company);
  const exact = candidates.find((c) => companyKey(c.login) === key || c.login.toLowerCase() === key);
  if (exact) return exact.login;
  const prefix = candidates.find((c) => c.login.toLowerCase().startsWith(key) && key.length >= 3);
  return prefix?.login ?? null;
}

/** Public profile of one user (cached), for adding them as a contact. */
export async function fetchGithubUser(login: string): Promise<any | null> {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)) return null;
  return new GithubClient(1).get<any>(`/users/${login}`);
}

export async function findGithubPeople(company: string, orgOverride?: string | null): Promise<GithubPeopleResult> {
  const client = new GithubClient();
  const result: GithubPeopleResult = {
    org: null,
    orgCandidates: [],
    people: [],
    source: 'none',
    rateLimited: false,
    rateLimitResetAt: null,
    message: null,
  };

  try {
    let login = orgOverride?.trim() || null;
    if (!login) {
      const search = await client.get<{ items: any[] }>(
        `/search/users?q=${encodeURIComponent(`${company} type:org`)}&per_page=5`
      );
      result.orgCandidates = (search?.items || []).map((o) => ({
        login: o.login,
        htmlUrl: o.html_url,
        avatarUrl: str(o.avatar_url),
      }));
      login = pickOrg(company, result.orgCandidates);
      if (!login) {
        result.message = result.orgCandidates.length
          ? 'No organisation clearly matches this company. Pick one of the candidates.'
          : 'No GitHub organisation found for this company.';
        return result;
      }
    }
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)) {
      result.message = 'Invalid GitHub organisation login.';
      return result;
    }

    const org = await client.get<any>(`/orgs/${login}`);
    if (!org) {
      result.message = `GitHub organisation "${login}" was not found.`;
      return result;
    }
    result.org = toOrg(org);
    const target = { key: companyKey(company), org: result.org.login };

    const members = (await client.get<any[]>(`/orgs/${result.org.login}/public_members?per_page=30`)) || [];
    let entries: { login: string; via: GithubPerson['via']; contributions?: number }[] = members
      .filter((m) => m.type !== 'Bot')
      .map((m) => ({ login: m.login, via: 'member' as const }));
    result.source = entries.length ? 'members' : 'none';

    if (!entries.length) {
      // Members are often private; fall back to top contributors of the most-starred repos.
      const repos = await client.get<{ items: any[] }>(
        `/search/repositories?q=${encodeURIComponent(`org:${result.org.login}`)}&sort=stars&order=desc&per_page=2`
      );
      const seen = new Map<string, number>();
      for (const repo of repos?.items || []) {
        const contributors = (await client.get<any[]>(`/repos/${repo.full_name}/contributors?per_page=10`)) || [];
        for (const c of contributors) {
          if (c.type !== 'User' || /\[bot\]$|-bot$/i.test(c.login)) continue;
          seen.set(c.login, (seen.get(c.login) || 0) + (c.contributions || 0));
        }
      }
      entries = [...seen.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([l, contributions]) => ({ login: l, via: 'contributor' as const, contributions }));
      if (entries.length) result.source = 'contributors';
    }

    for (const e of entries.slice(0, MAX_PEOPLE)) {
      try {
        const user = await client.get<any>(`/users/${e.login}`);
        if (user) result.people.push(toPerson(user, e.via, target, e.contributions));
      } catch (err) {
        if (err instanceof RequestBudgetError) break;
        throw err;
      }
    }
    if (!result.people.length && !result.message) {
      result.message = 'This organisation has no public members and no public contributors we could list.';
    } else if (result.source === 'contributors') {
      result.message = 'Members are private, so these are top contributors to its public repos. Some may not work there; check "company" on their profile.';
    }
  } catch (err) {
    if (err instanceof RateLimitError) {
      result.rateLimited = true;
      result.rateLimitResetAt = err.resetAt;
      result.message = 'GitHub rate limit reached. Try again later or set GITHUB_TOKEN.';
    } else if (err instanceof RequestBudgetError) {
      result.message = 'Stopped after the request limit for one lookup.';
    } else {
      result.message = `GitHub lookup failed: ${(err as Error).message}`;
    }
  }
  return result;
}
