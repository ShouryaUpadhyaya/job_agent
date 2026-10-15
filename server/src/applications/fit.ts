/**
 * "Fit" — a 0-100 composite used to rank pipeline applications: how good the match is,
 * how warm the path in is (VIT alumni / contacts), whether the listing is still fresh,
 * how far along the application is, and whether there is recent email activity.
 *
 * Pure: no DB access, `now` injected, so it is unit-testable.
 */

export const FIT_WEIGHTS = {
  match: 45,
  alumni: 20,
  contacts: 10,
  freshness: 10,
  stage: 10,
  email: 5,
} as const;

export type FitKey = keyof typeof FIT_WEIGHTS;

export interface FitComponent {
  key: FitKey;
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface FitResult {
  score: number;
  /** True for REJECTED/ARCHIVED: fit is forced to 0 and the card sinks to the bottom. */
  closed: boolean;
  breakdown: FitComponent[];
}

export interface FitInput {
  matchScore: number | null | undefined;
  alumniCount: number;
  contactCount: number;
  /** Contacts past the cold stage (accepted, messaged, replied, referred). */
  engagedCount: number;
  listingActive: boolean;
  /** Listing date: publishedAt, else when we first saw it. */
  listedAt: Date | null | undefined;
  stage: string;
  lastEmailAt: Date | null | undefined;
  now?: Date;
}

export const CLOSED_STAGES = ['REJECTED', 'ARCHIVED'];

/** Alumni saturate: the first one matters most, the third adds little, beyond 3 nothing. */
const ALUMNI_POINTS = [0, 10, 16, 20];

const STAGE_POINTS: Record<string, number> = {
  BOOKMARKED: 4,
  APPLYING: 6,
  APPLIED: 7,
  INTERVIEWING: 10,
  OFFERED: 10,
};

const DAY = 24 * 60 * 60 * 1000;

const days = (from: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - from.getTime()) / DAY));
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function matchPoints(score: number | null | undefined): number {
  const s = clamp(Number(score) || 0, 0, 100);
  return Math.round((s / 100) * FIT_WEIGHTS.match);
}

export function alumniPoints(n: number): number {
  return ALUMNI_POINTS[clamp(Math.floor(n) || 0, 0, 3)];
}

export function contactPoints(count: number, engaged: number): number {
  let p = 0;
  if (count >= 1) p += 3;
  if (count >= 3) p += 2;
  if (engaged >= 1) p += 5;
  return Math.min(FIT_WEIGHTS.contacts, p);
}

export function freshnessPoints(active: boolean, listedAt: Date | null | undefined, now: Date): number {
  if (!active) return 0;
  if (!listedAt) return 5;
  const age = days(listedAt, now);
  if (age <= 7) return 10;
  if (age <= 14) return 8;
  if (age <= 30) return 6;
  if (age <= 60) return 3;
  return 1;
}

export function stagePoints(stage: string): number {
  return STAGE_POINTS[stage] ?? 0;
}

export function emailPoints(lastEmailAt: Date | null | undefined, now: Date): number {
  if (!lastEmailAt) return 0;
  const age = days(lastEmailAt, now);
  if (age <= 7) return 5;
  if (age <= 30) return 3;
  return 1;
}

export function computeFit(input: FitInput): FitResult {
  const now = input.now ?? new Date();
  const listedAt = input.listedAt ?? null;
  const breakdown: FitComponent[] = [
    {
      key: 'match',
      label: 'Resume match',
      points: matchPoints(input.matchScore),
      max: FIT_WEIGHTS.match,
      detail: `Match score ${clamp(Number(input.matchScore) || 0, 0, 100)}/100`,
    },
    {
      key: 'alumni',
      label: 'VIT alumni there',
      points: alumniPoints(input.alumniCount),
      max: FIT_WEIGHTS.alumni,
      detail: input.alumniCount
        ? `${input.alumniCount} VIT ${input.alumniCount === 1 ? 'alumnus' : 'alumni'} saved`
        : 'None saved yet',
    },
    {
      key: 'contacts',
      label: 'Contacts',
      points: contactPoints(input.contactCount, input.engagedCount),
      max: FIT_WEIGHTS.contacts,
      detail: input.contactCount
        ? `${plural(input.contactCount, 'contact')}${input.engagedCount ? `, ${input.engagedCount} engaged` : ''}`
        : 'No contacts at this company',
    },
    {
      key: 'freshness',
      label: 'Listing freshness',
      points: freshnessPoints(input.listingActive, listedAt, now),
      max: FIT_WEIGHTS.freshness,
      detail: !input.listingActive
        ? 'Listing closed'
        : listedAt
          ? `Listed ${plural(days(listedAt, now), 'day')} ago`
          : 'Listing date unknown',
    },
    {
      key: 'stage',
      label: 'Stage momentum',
      points: stagePoints(input.stage),
      max: FIT_WEIGHTS.stage,
      detail: input.stage,
    },
    {
      key: 'email',
      label: 'Recent email',
      points: emailPoints(input.lastEmailAt, now),
      max: FIT_WEIGHTS.email,
      detail: input.lastEmailAt ? `Last email ${plural(days(input.lastEmailAt, now), 'day')} ago` : 'No emails yet',
    },
  ];

  const closed = CLOSED_STAGES.includes(input.stage);
  const total = breakdown.reduce((sum, c) => sum + c.points, 0);
  return { score: closed ? 0 : clamp(Math.round(total), 0, 100), closed, breakdown };
}
