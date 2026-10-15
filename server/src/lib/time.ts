/**
 * The user lives in India; "today" everywhere in the app means the IST calendar day,
 * regardless of the server/container timezone.
 */

export const APP_TIMEZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** "YYYY-MM-DD" of the IST calendar day containing `date`. */
export function istDateKey(date: Date = new Date()): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant at which the IST day containing `date` begins. */
export function istStartOfDay(date: Date = new Date()): Date {
  return new Date(Date.parse(`${istDateKey(date)}T00:00:00.000Z`) - IST_OFFSET_MS);
}

export function istEndOfDay(date: Date = new Date()): Date {
  return new Date(istStartOfDay(date).getTime() + 24 * 60 * 60 * 1000 - 1);
}

/** A stable DateTime to store as a per-IST-day key (UTC midnight of the IST date). */
export function istDayAsUtcMidnight(date: Date = new Date()): Date {
  return new Date(`${istDateKey(date)}T00:00:00.000Z`);
}

export function istHour(date: Date = new Date()): number {
  return new Date(date.getTime() + IST_OFFSET_MS).getUTCHours();
}

export function daysAgo(days: number, from: Date = new Date()): Date {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Parses timestamps written by the Wellfound runner. New rows are ISO strings; legacy
 * rows are host-local "M/D/YYYY, h:mm:ss AM" strings written on an IST machine.
 */
export function parseRunnerTimestamp(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?$/i);
  if (m) {
    const [, mo, da, yr, hRaw, mi, se, ampm] = m;
    let h = parseInt(hRaw, 10);
    if (ampm) {
      const pm = ampm.toUpperCase() === 'PM';
      if (h === 12) h = pm ? 12 : 0;
      else if (pm) h += 12;
    }
    const utc = Date.UTC(+yr, +mo - 1, +da, h, +mi, se ? +se : 0) - IST_OFFSET_MS;
    return new Date(utc);
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}
