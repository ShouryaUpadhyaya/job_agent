/** Shared vocabularies for the networking CRM. */

export const CONTACT_STATUSES = [
  'RESEARCHED',
  'READY_TO_CONNECT',
  'REQUEST_SENT',
  'ACCEPTED',
  'MESSAGE_DRAFTED',
  'MESSAGE_SENT',
  'REPLIED',
  'REFERRAL_REQUESTED',
  'REFERRED',
  'NOT_INTERESTED',
  'FOLLOW_UP_DUE',
] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const PERSONAS = ['ENGINEER', 'FULLSTACK', 'RECRUITER', 'FOUNDER_CXO', 'MANAGER', 'OTHER'] as const;
export type Persona = (typeof PERSONAS)[number];

export const CONTACT_SOURCES = ['MANUAL', 'GMAIL', 'GITHUB', 'IMPORT'] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

export const EMAIL_SOURCES = ['gmail', 'github', 'manual'] as const;
export type EmailSource = (typeof EMAIL_SOURCES)[number];

export const MESSAGE_TYPES = ['CONNECTION_NOTE', 'REFERRAL_ASK', 'FOLLOW_UP', 'THANK_YOU'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

/** Older rows (and the Gmail auto-draft) use these names; they count as the same type. */
export const LEGACY_MESSAGE_TYPES: Record<string, MessageType> = {
  CONNECTION_REQUEST: 'CONNECTION_NOTE',
  REFERRAL_FOLLOWUP: 'REFERRAL_ASK',
  FOLLOWUP_REMINDER: 'FOLLOW_UP',
};

export function canonicalMessageType(type: string): MessageType | null {
  if ((MESSAGE_TYPES as readonly string[]).includes(type)) return type as MessageType;
  return LEGACY_MESSAGE_TYPES[type] ?? null;
}

/** Every stored type name that means `type` (canonical plus legacy aliases). */
export function messageTypeAliases(type: MessageType): string[] {
  return [type, ...Object.entries(LEGACY_MESSAGE_TYPES).filter(([, v]) => v === type).map(([k]) => k)];
}

export const MESSAGE_STATUSES = ['DRAFT', 'APPROVED', 'SENT'] as const;

/** Statuses where the conversation is over (no follow-up reminders). */
export const CLOSED_STATUSES: ContactStatus[] = ['REPLIED', 'REFERRED', 'NOT_INTERESTED'];

export const CONNECTION_NOTE_LIMIT = 300;
export const REFERRAL_ASK_WORD_LIMIT = 120;
export const FOLLOW_UP_DAYS = 6;
export const FOLLOW_UP_MIN_DAYS = 5;
export const REQUEST_CHECK_DAYS = 7;

export const DAY_MS = 24 * 60 * 60 * 1000;

export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}
