/**
 * Gmail OAuth configuration. The docs and .env.example use GMAIL_*; older code used GOOGLE_*.
 * Both are accepted (GMAIL_* wins). Nothing falls back to dummy credentials: when the client
 * id/secret are missing the integration reports `configured: false` with setup steps.
 */

export const DEFAULT_REDIRECT_URI = 'http://localhost:3001/api/gmail/oauth2callback';

export interface GmailConfig {
  configured: boolean;
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string;
  /** Env var names that still need a value. */
  missing: string[];
}

function env(...names: string[]): string | null {
  for (const n of names) {
    const v = process.env[n]?.trim();
    if (v) return v;
  }
  return null;
}

export function getGmailConfig(): GmailConfig {
  const clientId = env('GMAIL_CLIENT_ID', 'GOOGLE_CLIENT_ID');
  const clientSecret = env('GMAIL_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET');
  const redirectUri = env('GMAIL_REDIRECT_URI', 'GOOGLE_REDIRECT_URI') || DEFAULT_REDIRECT_URI;
  const missing: string[] = [];
  if (!clientId) missing.push('GMAIL_CLIENT_ID');
  if (!clientSecret) missing.push('GMAIL_CLIENT_SECRET');
  return { configured: missing.length === 0, clientId, clientSecret, redirectUri, missing };
}

export function setupInstructions(redirectUri = getGmailConfig().redirectUri): string[] {
  return [
    'Open https://console.cloud.google.com/ and create (or pick) a project.',
    'APIs & Services → Library → enable the "Gmail API".',
    'APIs & Services → OAuth consent screen: User type "External", add your Gmail address under Test users, and add the scopes gmail.readonly, userinfo.email and userinfo.profile.',
    'APIs & Services → Credentials → Create credentials → OAuth client ID → Application type "Web application".',
    `Under "Authorized redirect URIs" add exactly: ${redirectUri}`,
    'Copy the client ID and secret into the root .env as GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET (and GMAIL_REDIRECT_URI if you changed the URI), then restart the server.',
  ];
}

/** First sync looks back this many days (GMAIL_INITIAL_LOOKBACK_DAYS, default 60). */
export function initialLookbackDays(): number {
  const n = parseInt(process.env.GMAIL_INITIAL_LOOKBACK_DAYS || '', 10);
  return Number.isFinite(n) && n > 0 && n <= 365 ? n : 60;
}

/** Most messages processed in one sync run (GMAIL_SYNC_MAX_MESSAGES, default 150). */
export function maxMessagesPerSync(): number {
  const n = parseInt(process.env.GMAIL_SYNC_MAX_MESSAGES || '', 10);
  return Number.isFinite(n) && n > 0 && n <= 1000 ? n : 150;
}
