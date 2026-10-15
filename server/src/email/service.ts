import { google } from 'googleapis';
import { Prisma, ConnectedAccount } from '@prisma/client';
import { prisma } from '../db';
import { classifyJobEmail, ClassificationResult } from './classifier';
import { refineWithGemini } from './refine';
import { applyEffects, EffectsOutcome } from './effects';
import { getGmailConfig, initialLookbackDays, maxMessagesPerSync, setupInstructions } from './config';
import { createOAuthState, consumeOAuthState } from './oauthState';
import { buildGmailQuery } from './query';
import { bodyText, extractBodies, header, GmailPart, MAX_STORED_BODY, parseFrom } from './mime';
import { DEMO_PREFIX, demoEmails } from './demo';

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/gmail.readonly',
];

const DAY_MS = 24 * 60 * 60 * 1000;
const LIST_PAGE_SIZE = 100;
const LIST_MAX_IDS = 1000;
const MAX_GEMINI_REFINES_PER_SYNC = 20;

export class GmailError extends Error {
  constructor(
    public httpStatus: number,
    public code: string,
    message: string,
    public fix?: string
  ) {
    super(message);
  }
}

export interface RawEmail {
  messageId: string;
  threadId?: string | null;
  /** Address or full From header. */
  sender: string;
  senderName?: string | null;
  subject: string;
  snippet?: string | null;
  body?: string | null;
  html?: string | null;
  receivedAt?: Date;
}

export interface ProcessResult {
  event: Prisma.EmailEventGetPayload<object>;
  classification: ClassificationResult | null;
  skipped: boolean;
  effects?: EffectsOutcome;
  error?: string;
}

export interface SyncStats {
  startedAt: string;
  finishedAt: string;
  after: string;
  fetched: number;
  new: number;
  skipped: number;
  errors: number;
  remaining: number;
  truncated: boolean;
  byClassification: Record<string, number>;
  stageChanges: number;
  applicationsCreated: number;
  contactsCreated: number;
  jobAlertListings: number;
}

export interface SyncResult extends SyncStats {
  events: Prisma.EmailEventGetPayload<object>[];
  errorDetails: { messageId: string; error: string }[];
}

export interface LastError {
  at: string;
  code: string;
  message: string;
  fix?: string;
}

type Metadata = {
  name?: string | null;
  picture?: string | null;
  syncCursor?: string | null;
  lastSync?: SyncStats | null;
  lastError?: LastError | null;
  [k: string]: unknown;
};

function meta(account: Pick<ConnectedAccount, 'metadata'> | null | undefined): Metadata {
  const m = account?.metadata;
  return m && typeof m === 'object' && !Array.isArray(m) ? (m as Metadata) : {};
}

/** Maps a googleapis/gaxios error to a code, message and the fix the user should apply. */
export function describeGoogleError(err: unknown): { code: string; message: string; fix: string; expired: boolean } {
  const e = err as { message?: string; code?: string | number; status?: number; response?: { status?: number; data?: any } };
  const data = e?.response?.data;
  const status = e?.response?.status ?? e?.status ?? (typeof e?.code === 'number' ? e.code : undefined);
  const apiCode = typeof data?.error === 'string' ? data.error : '';
  const message = String(data?.error_description || data?.error?.message || e?.message || 'Unknown Gmail error').slice(0, 300);
  const text = `${apiCode} ${message}`;

  if (/invalid_grant|expired or revoked/i.test(text) || status === 401) {
    return {
      code: 'invalid_grant',
      message,
      expired: true,
      fix: 'Reconnect Gmail. The saved authorization was revoked or expired (Google expires refresh tokens after 7 days while the OAuth app is in "Testing" publishing status).',
    };
  }
  if (/invalid_client|unauthorized_client/i.test(text)) {
    return { code: 'invalid_client', message, expired: false, fix: 'GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET do not match the Google Cloud OAuth client. Fix them in .env and restart the server.' };
  }
  if (/has not been used|is disabled|accessNotConfigured|SERVICE_DISABLED/i.test(text)) {
    return { code: 'api_disabled', message, expired: false, fix: 'Enable the Gmail API for your Google Cloud project (APIs & Services → Library → Gmail API → Enable), wait a minute, then sync again.' };
  }
  if (status === 403 || /insufficient/i.test(text)) {
    return { code: 'insufficient_scope', message, expired: false, fix: 'Reconnect Gmail and allow "Read your email" on the consent screen.' };
  }
  if (status === 429 || /rate limit|quota/i.test(text)) {
    return { code: 'rate_limited', message, expired: false, fix: 'Gmail rate limit hit. Wait a few minutes and sync again.' };
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|network|fetch failed/i.test(text)) {
    return { code: 'network', message, expired: false, fix: 'Could not reach Google. Check the server\'s internet connection and try again.' };
  }
  return { code: 'gmail_error', message, expired: false, fix: 'Try syncing again; if it keeps failing, disconnect and reconnect Gmail.' };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export class GmailService {
  private newClient() {
    const cfg = getGmailConfig();
    if (!cfg.configured) {
      throw new GmailError(400, 'not_configured', `Gmail is not configured: set ${cfg.missing.join(' and ')} in .env.`, setupInstructions(cfg.redirectUri).join(' '));
    }
    return new google.auth.OAuth2(cfg.clientId!, cfg.clientSecret!, cfg.redirectUri);
  }

  /** OAuth client for a stored account; refreshed tokens are written back to the account. */
  private clientFor(account: ConnectedAccount) {
    const client = this.newClient();
    client.setCredentials({
      access_token: account.accessToken || undefined,
      refresh_token: account.refreshToken || undefined,
      expiry_date: account.tokenExpiry ? account.tokenExpiry.getTime() : undefined,
    });
    client.on('tokens', (tokens) => {
      const data: Prisma.ConnectedAccountUpdateInput = {};
      if (tokens.access_token) data.accessToken = tokens.access_token;
      if (tokens.expiry_date) data.tokenExpiry = new Date(tokens.expiry_date);
      if (tokens.refresh_token) data.refreshToken = tokens.refresh_token;
      if (!Object.keys(data).length) return;
      prisma.connectedAccount.update({ where: { id: account.id }, data }).catch((err) => {
        console.warn('[gmail] could not persist refreshed tokens:', err?.message);
      });
    });
    return client;
  }

  getAuthUrl(): string {
    const client = this.newClient();
    const scopes = [...GMAIL_SCOPES];
    if (process.env.ENABLE_GMAIL_SEND === 'true') scopes.push('https://www.googleapis.com/auth/gmail.send');
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: scopes,
      state: createOAuthState(),
    });
  }

  /** Verifies `state`, exchanges the code and stores the account. */
  async handleOAuthCallback(code: string, state: string | null | undefined) {
    if (!consumeOAuthState(state)) {
      throw new GmailError(400, 'invalid_state', 'The sign-in link expired or did not come from this app. Click Connect again.');
    }
    const client = this.newClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    const userInfo = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
    const email = userInfo.data.email;
    if (!email) throw new GmailError(400, 'no_email', 'Google did not return an email address for this account.');

    const existing = await prisma.connectedAccount.findUnique({ where: { provider_email: { provider: 'gmail', email } } });
    const scopes = tokens.scope ? tokens.scope.split(' ') : [];
    if (scopes.length && !scopes.includes('https://www.googleapis.com/auth/gmail.readonly')) {
      throw new GmailError(400, 'insufficient_scope', 'Gmail read access was not granted. Connect again and allow "Read your email".');
    }
    const metadata: Metadata = { ...meta(existing), name: userInfo.data.name ?? null, picture: userInfo.data.picture ?? null, lastError: null };
    const common = {
      accessToken: tokens.access_token || null,
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scopes,
      status: 'CONNECTED',
      metadata: metadata as Prisma.InputJsonValue,
    };
    return prisma.connectedAccount.upsert({
      where: { provider_email: { provider: 'gmail', email } },
      // Google omits refresh_token on re-consent sometimes; keep the stored one then.
      update: { ...common, ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}) },
      create: { ...common, provider: 'gmail', email, refreshToken: tokens.refresh_token || null },
    });
  }

  private async currentAccount() {
    return (
      (await prisma.connectedAccount.findFirst({ where: { provider: 'gmail', status: { in: ['CONNECTED', 'EXPIRED'] } }, orderBy: { updatedAt: 'desc' } })) ||
      (await prisma.connectedAccount.findFirst({ where: { provider: 'gmail' }, orderBy: { updatedAt: 'desc' } }))
    );
  }

  async getStatus() {
    const cfg = getGmailConfig();
    const account = await this.currentAccount();
    const m = meta(account);
    const [totalEventsTracked, demoEvents] = await Promise.all([
      prisma.emailEvent.count({ where: { isDemo: false } }),
      prisma.emailEvent.count({ where: { isDemo: true } }),
    ]);
    return {
      configured: cfg.configured,
      hasCredentialsConfigured: cfg.configured,
      missingEnv: cfg.missing,
      redirectUri: cfg.redirectUri,
      setup: cfg.configured ? [] : setupInstructions(cfg.redirectUri),
      connected: account?.status === 'CONNECTED',
      accountStatus: account?.status ?? null,
      email: account && account.status !== 'DISCONNECTED' ? account.email : null,
      lastSyncedAt: account?.lastSyncedAt ?? null,
      lastSync: m.lastSync ?? null,
      lastError: m.lastError ?? null,
      totalEventsTracked,
      demoEvents,
    };
  }

  /** Revokes and forgets every connected Gmail account. */
  async disconnect() {
    const accounts = await prisma.connectedAccount.findMany({ where: { provider: 'gmail', status: { not: 'DISCONNECTED' } } });
    let revoked = 0;
    for (const account of accounts) {
      const token = account.refreshToken || account.accessToken;
      if (token && getGmailConfig().configured) {
        try {
          await this.newClient().revokeToken(token);
          revoked++;
        } catch (err: any) {
          console.warn('[gmail] token revoke failed (continuing):', err?.message);
        }
      }
      await prisma.connectedAccount.update({
        where: { id: account.id },
        data: { status: 'DISCONNECTED', accessToken: null, refreshToken: null, tokenExpiry: null },
      });
    }
    return { status: 'disconnected', accounts: accounts.length, revoked };
  }

  /**
   * Classifies and stores one email, then runs its side effects. A message already stored is
   * skipped before anything else happens, so re-syncs never repeat stage changes or drafts.
   * Demo emails are stored with isDemo=true and no side effects.
   */
  async processEmail(raw: RawEmail, opts: { isDemo?: boolean; refine?: boolean } = {}): Promise<ProcessResult> {
    const existing = await prisma.emailEvent.findUnique({ where: { messageId: raw.messageId } });
    if (existing) return { event: existing, classification: null, skipped: true };

    const from = parseFrom(raw.sender);
    const senderName = raw.senderName ?? from.name;
    const body = (raw.body || raw.snippet || '').slice(0, MAX_STORED_BODY);
    const receivedAt = raw.receivedAt && !isNaN(raw.receivedAt.getTime()) ? raw.receivedAt : new Date();

    let classification = classifyJobEmail({ subject: raw.subject, body, sender: from.email, senderName: senderName ?? undefined });
    let aiRefined = false;
    if (opts.refine && !opts.isDemo) {
      const refined = await refineWithGemini(classification, { subject: raw.subject, sender: raw.sender, body });
      aiRefined = refined !== classification;
      classification = refined;
    }

    let event;
    try {
      event = await prisma.emailEvent.create({
        data: {
          messageId: raw.messageId,
          threadId: raw.threadId || null,
          sender: from.email,
          senderName: senderName || null,
          subject: raw.subject.slice(0, 500),
          snippet: (raw.snippet || body.slice(0, 200)) || null,
          body: body || null,
          importance: classification.importance,
          isDemo: Boolean(opts.isDemo),
          receivedAt,
          classification: classification.classification,
          confidence: classification.confidence,
          explanation: classification.explanation,
          suggestedAction: classification.suggestedAction,
          company: classification.company || null,
          role: classification.role || null,
          isProcessed: Boolean(opts.isDemo),
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const again = await prisma.emailEvent.findUnique({ where: { messageId: raw.messageId } });
        if (again) return { event: again, classification: null, skipped: true };
      }
      throw err;
    }
    if (opts.isDemo) return { event, classification, skipped: false };

    try {
      const effects = await applyEffects(
        classification,
        { messageId: raw.messageId, sender: from.email, senderName, subject: raw.subject, body, html: raw.html, receivedAt },
        { aiRefined }
      );
      event = await prisma.emailEvent.update({
        where: { id: event.id },
        data: {
          jobApplicationId: effects.jobApplicationId,
          networkingContactId: effects.networkingContactId,
          explanation: [classification.explanation, ...effects.notes].join(' ').slice(0, 2000),
          isProcessed: true,
        },
      });
      return { event, classification, skipped: false, effects };
    } catch (err: any) {
      const message = String(err?.message || err).slice(0, 300);
      console.warn(`[gmail] effects failed for ${raw.messageId}:`, message);
      event = await prisma.emailEvent.update({
        where: { id: event.id },
        data: { explanation: `${classification.explanation} Processing error: ${message}`.slice(0, 2000) },
      });
      return { event, classification, skipped: false, error: message };
    }
  }

  private async recordError(account: ConnectedAccount, err: unknown): Promise<GmailError> {
    const d = describeGoogleError(err);
    const lastError: LastError = { at: new Date().toISOString(), code: d.code, message: d.message, fix: d.fix };
    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: {
        ...(d.expired ? { status: 'EXPIRED' } : {}),
        metadata: { ...meta(account), lastError } as unknown as Prisma.InputJsonValue,
      },
    });
    return new GmailError(d.expired ? 401 : 502, d.code, d.message, d.fix);
  }

  /** Incremental sync of the connected mailbox. Never inserts demo data. */
  async syncInbox(now = new Date()): Promise<SyncResult> {
    if (!getGmailConfig().configured) this.newClient(); // throws not_configured
    const account = await prisma.connectedAccount.findFirst({ where: { provider: 'gmail', status: 'CONNECTED' }, orderBy: { updatedAt: 'desc' } });
    if (!account) {
      const expired = await prisma.connectedAccount.findFirst({ where: { provider: 'gmail', status: 'EXPIRED' } });
      if (expired) throw new GmailError(401, 'invalid_grant', 'Gmail authorization expired.', 'Reconnect Gmail.');
      throw new GmailError(409, 'not_connected', 'Gmail is not connected.', 'Click "Connect Gmail" first.');
    }
    if (!account.accessToken && !account.refreshToken) {
      throw new GmailError(401, 'invalid_grant', 'No Gmail tokens stored for this account.', 'Reconnect Gmail.');
    }

    const m = meta(account);
    const cursor = m.syncCursor ? new Date(m.syncCursor) : null;
    const after = cursor && !isNaN(cursor.getTime()) ? new Date(cursor.getTime() - DAY_MS) : new Date(now.getTime() - initialLookbackDays() * DAY_MS);
    const gmail = google.gmail({ version: 'v1', auth: this.clientFor(account) });
    const accountEmail = (account.email || '').toLowerCase();

    // 1. List matching ids (newest first) across pages.
    const ids: string[] = [];
    let truncated = false;
    try {
      let pageToken: string | undefined;
      do {
        const res = await gmail.users.messages.list({ userId: 'me', q: buildGmailQuery(after), maxResults: LIST_PAGE_SIZE, pageToken });
        for (const msg of res.data.messages || []) if (msg.id) ids.push(msg.id);
        pageToken = res.data.nextPageToken || undefined;
        if (ids.length >= LIST_MAX_IDS && pageToken) {
          truncated = true;
          break;
        }
      } while (pageToken);
    } catch (err) {
      throw await this.recordError(account, err);
    }

    // 2. Skip stored messages before fetching or touching anything.
    const unique = [...new Set(ids)];
    const stored = new Set(
      (await prisma.emailEvent.findMany({ where: { messageId: { in: unique } }, select: { messageId: true } })).map((e) => e.messageId)
    );
    const fresh = unique.filter((id) => !stored.has(id)); // newest → oldest
    const max = maxMessagesPerSync();
    const batch = fresh.slice(-max); // the oldest `max` new messages
    const remaining = fresh.length - batch.length;

    // 3. Fetch details, then process oldest → newest.
    const errorDetails: { messageId: string; error: string }[] = [];
    const details: { id: string; internalDate: number; data: any }[] = [];
    for (const id of batch) {
      try {
        const res = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
        details.push({ id, internalDate: Number(res.data.internalDate) || 0, data: res.data });
      } catch (err) {
        const d = describeGoogleError(err);
        if (d.expired) throw await this.recordError(account, err);
        errorDetails.push({ messageId: id, error: d.message });
      }
    }
    details.sort((a, b) => a.internalDate - b.internalDate);

    const events: SyncResult['events'] = [];
    const byClassification: Record<string, number> = {};
    let skipped = stored.size;
    let stageChanges = 0;
    let applicationsCreated = 0;
    let contactsCreated = 0;
    let jobAlertListings = 0;
    let newestProcessed = 0;
    let refines = 0;

    for (const d of details) {
      try {
        const payload = d.data.payload as GmailPart;
        const fromHeader = header(payload, 'From');
        const parsed = parseFrom(fromHeader);
        if (accountEmail && parsed.email === accountEmail) {
          skipped++;
          continue;
        }
        const bodies = extractBodies(payload);
        const dateHeader = header(payload, 'Date');
        const receivedAt = d.internalDate ? new Date(d.internalDate) : dateHeader ? new Date(dateHeader) : now;
        const refine = refines < MAX_GEMINI_REFINES_PER_SYNC;
        const result = await this.processEmail(
          {
            messageId: d.id,
            threadId: d.data.threadId,
            sender: fromHeader,
            senderName: parsed.name,
            subject: header(payload, 'Subject') || '(no subject)',
            snippet: d.data.snippet || '',
            body: bodyText(bodies) || d.data.snippet || '',
            html: bodies.html || null,
            receivedAt,
          },
          { refine }
        );
        if (refine && result.classification && result.classification.confidence < 0.6) refines++;
        if (result.skipped) {
          skipped++;
          continue;
        }
        events.push(result.event);
        byClassification[result.event.classification] = (byClassification[result.event.classification] || 0) + 1;
        if (result.error) errorDetails.push({ messageId: d.id, error: result.error });
        if (result.effects?.stageChange) stageChanges++;
        if (result.effects?.createdApplication) applicationsCreated++;
        if (result.effects?.createdContact) contactsCreated++;
        if (result.effects?.alert) jobAlertListings += result.effects.alert.created;
        newestProcessed = Math.max(newestProcessed, receivedAt.getTime());
      } catch (err: any) {
        errorDetails.push({ messageId: d.id, error: String(err?.message || err).slice(0, 300) });
      }
    }

    const finishedAt = new Date();
    const stats: SyncStats = {
      startedAt: now.toISOString(),
      finishedAt: finishedAt.toISOString(),
      after: after.toISOString(),
      fetched: unique.length,
      new: events.length,
      skipped,
      errors: errorDetails.length,
      remaining,
      truncated,
      byClassification,
      stageChanges,
      applicationsCreated,
      contactsCreated,
      jobAlertListings,
    };
    // With messages left over, resume from the newest one processed (minus the 1-day overlap).
    const nextCursor = remaining > 0 && newestProcessed ? new Date(newestProcessed) : now;
    const fresher = await prisma.connectedAccount.findUnique({ where: { id: account.id } });
    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: {
        lastSyncedAt: finishedAt,
        metadata: { ...meta(fresher), syncCursor: nextCursor.toISOString(), lastSync: stats, lastError: null } as unknown as Prisma.InputJsonValue,
      },
    });

    return { ...stats, events, errorDetails };
  }

  /** Explicit demo action: stores sample events flagged isDemo with no side effects. */
  async loadDemo() {
    let created = 0;
    for (const email of demoEmails()) {
      const r = await this.processEmail(email, { isDemo: true });
      if (!r.skipped) created++;
    }
    return { created };
  }

  async clearDemo() {
    const res = await prisma.emailEvent.deleteMany({ where: { OR: [{ isDemo: true }, { messageId: { startsWith: DEMO_PREFIX } }] } });
    return { deleted: res.count };
  }
}

export const gmailService = new GmailService();
