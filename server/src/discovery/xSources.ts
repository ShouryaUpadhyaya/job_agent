import fs from 'fs';
import path from 'path';

export interface XSource {
  handle: string;
  name: string;
  url: string;
  posts: string;
  evidence: string;
  evidenceUrl: string;
  confidence: string;
}

export interface XSourcesPayload {
  checkedAt: string;
  note: string;
  searchUrl: string;
  accounts: XSource[];
}

const FALLBACK_SEARCH =
  'https://x.com/search?q=(internship%20OR%20intern)%20(hiring%20OR%20apply)%20india%20min_faves%3A20&f=live';

let cached: XSourcesPayload | null = null;

/**
 * Researched X accounts (see docs/X_SOURCES.md), read from xSources.json. Shown as links only;
 * nothing is fetched from X. `tsc` does not copy JSON into dist, so the source copy is used
 * when running from a build.
 */
export function getXSources(): XSourcesPayload {
  if (cached) return cached;
  const candidates = [
    path.join(__dirname, 'xSources.json'),
    path.resolve(__dirname, '../../src/discovery/xSources.json'),
  ];
  for (const file of candidates) {
    try {
      cached = JSON.parse(fs.readFileSync(file, 'utf8')) as XSourcesPayload;
      return cached;
    } catch {
      // try next location
    }
  }
  return { checkedAt: '', note: 'xSources.json not found', searchUrl: FALLBACK_SEARCH, accounts: [] };
}
