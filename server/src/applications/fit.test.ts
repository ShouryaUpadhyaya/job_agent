import { describe, expect, it } from 'vitest';
import {
  FIT_WEIGHTS,
  alumniPoints,
  computeFit,
  contactPoints,
  emailPoints,
  freshnessPoints,
  matchPoints,
  stagePoints,
} from './fit';

const NOW = new Date('2026-10-15T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

const base = {
  matchScore: 80,
  alumniCount: 0,
  contactCount: 0,
  engagedCount: 0,
  listingActive: true,
  listedAt: daysAgo(3),
  stage: 'BOOKMARKED',
  lastEmailAt: null,
  now: NOW,
};

describe('fit score', () => {
  it('weights sum to 100', () => {
    expect(Object.values(FIT_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('scales match score to its weight and clamps out-of-range scores', () => {
    expect(matchPoints(100)).toBe(45);
    expect(matchPoints(0)).toBe(0);
    expect(matchPoints(150)).toBe(45);
    expect(matchPoints(-5)).toBe(0);
    expect(matchPoints(null)).toBe(0);
  });

  it('saturates alumni after 3', () => {
    expect(alumniPoints(0)).toBe(0);
    expect(alumniPoints(1)).toBe(10);
    expect(alumniPoints(2)).toBe(16);
    expect(alumniPoints(3)).toBe(20);
    expect(alumniPoints(12)).toBe(20);
  });

  it('rewards contacts and engaged contacts, capped at 10', () => {
    expect(contactPoints(0, 0)).toBe(0);
    expect(contactPoints(1, 0)).toBe(3);
    expect(contactPoints(3, 0)).toBe(5);
    expect(contactPoints(5, 2)).toBe(10);
  });

  it('freshness drops with age and is 0 for closed listings', () => {
    expect(freshnessPoints(true, daysAgo(2), NOW)).toBe(10);
    expect(freshnessPoints(true, daysAgo(20), NOW)).toBe(6);
    expect(freshnessPoints(true, daysAgo(200), NOW)).toBe(1);
    expect(freshnessPoints(true, null, NOW)).toBe(5);
    expect(freshnessPoints(false, daysAgo(1), NOW)).toBe(0);
  });

  it('stage momentum favours interviewing over bookmarked', () => {
    expect(stagePoints('INTERVIEWING')).toBeGreaterThan(stagePoints('APPLIED'));
    expect(stagePoints('APPLIED')).toBeGreaterThan(stagePoints('BOOKMARKED'));
    expect(stagePoints('WHATEVER')).toBe(0);
  });

  it('recent email counts more than old email', () => {
    expect(emailPoints(daysAgo(1), NOW)).toBe(5);
    expect(emailPoints(daysAgo(20), NOW)).toBe(3);
    expect(emailPoints(daysAgo(90), NOW)).toBe(1);
    expect(emailPoints(null, NOW)).toBe(0);
  });

  it('sums the breakdown into the score', () => {
    const fit = computeFit(base);
    expect(fit.closed).toBe(false);
    expect(fit.breakdown.map((c) => c.key)).toEqual(['match', 'alumni', 'contacts', 'freshness', 'stage', 'email']);
    expect(fit.score).toBe(fit.breakdown.reduce((s, c) => s + c.points, 0));
    expect(fit.score).toBe(36 + 0 + 0 + 10 + 4 + 0);
  });

  it('an application with alumni and momentum beats an equal match without', () => {
    const cold = computeFit(base);
    const warm = computeFit({ ...base, alumniCount: 2, contactCount: 3, engagedCount: 1, stage: 'INTERVIEWING', lastEmailAt: daysAgo(2) });
    expect(warm.score).toBeGreaterThan(cold.score);
    expect(warm.score).toBeLessThanOrEqual(100);
  });

  it('maxes out at 100', () => {
    const fit = computeFit({ ...base, matchScore: 100, alumniCount: 5, contactCount: 5, engagedCount: 3, stage: 'OFFERED', lastEmailAt: daysAgo(0) });
    expect(fit.score).toBe(100);
  });

  it('rejected and archived applications score 0 but keep the breakdown', () => {
    for (const stage of ['REJECTED', 'ARCHIVED']) {
      const fit = computeFit({ ...base, stage, alumniCount: 3 });
      expect(fit.score).toBe(0);
      expect(fit.closed).toBe(true);
      expect(fit.breakdown.find((c) => c.key === 'alumni')!.points).toBe(20);
    }
  });
});
