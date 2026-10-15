import fs from 'fs';
import path from 'path';
import { CandidateProfile, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { ensureActiveProfile } from '../lib/profile';
import { envFile, runnerConfigFile, scriptsLib } from './paths';
import { updateEnvText } from './envFile';

/**
 * Wellfound application profile. The database CandidateProfile (+ applicationAnswers) is the
 * source of truth; empty fields fall back to the legacy wellfound_autoApply/.env (read-only) and
 * then to scripts/wellfound/profile-defaults.json (resume facts).
 */

export const PROFILE_FIELDS = [
  'name', 'email', 'phone', 'location', 'school', 'currentRole', 'company', 'education', 'yearsOfExperience',
  'skills', 'highlights', 'noticePeriod', 'currentCTC', 'expectedCTC', 'dob', 'gender', 'workAuth',
  'github', 'linkedin', 'portfolio', 'x',
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export interface WellfoundProfile {
  name: string; email: string; phone: string; location: string; school: string;
  currentRole: string; company: string; education: string; yearsOfExperience: string;
  skills: string; highlights: string[];
  noticePeriod: string; currentCTC: string; expectedCTC: string; dob: string; gender: string; workAuth: string;
  github: string; linkedin: string; portfolio: string; x: string;
}

export interface WellfoundRules {
  dailyCap: number;
  autoTickTerms: boolean;
  maxRuntimeMinutes: number;
}

export type FieldSource = 'profile' | 'legacy-env' | 'resume-defaults' | 'empty';

export const DEFAULT_RULES: WellfoundRules = { dailyCap: 25, autoTickTerms: true, maxRuntimeMinutes: 100 };

/** Columns on CandidateProfile; every other field lives in applicationAnswers. */
const COLUMN_FIELDS: Partial<Record<ProfileField, keyof CandidateProfile>> = {
  name: 'name', email: 'email', phone: 'phone', location: 'location', school: 'school',
  github: 'githubUrl', linkedin: 'linkedinUrl', portfolio: 'portfolioUrl', x: 'xUrl',
};

const PLACEHOLDER_NAME = /^(your name|test candidate|default candidate|candidate)$/i;
const PLACEHOLDER_EMAIL = /@example\.(com|org)$/i;

function answersOf(profile: CandidateProfile | null): Record<string, any> {
  const a = profile?.applicationAnswers;
  return a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, any>) : {};
}

function nonEmpty(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return v != null && String(v).trim() !== '';
}

function profileValue(profile: CandidateProfile | null, field: ProfileField): unknown {
  if (!profile) return undefined;
  if (field === 'skills') return profile.skills?.length ? profile.skills.join(', ') : undefined;
  const col = COLUMN_FIELDS[field];
  if (col) {
    const v = profile[col] as unknown;
    if (field === 'name' && typeof v === 'string' && PLACEHOLDER_NAME.test(v.trim())) return undefined;
    if (field === 'email' && typeof v === 'string' && PLACEHOLDER_EMAIL.test(v.trim())) return undefined;
    return v;
  }
  return answersOf(profile)[field];
}

function normalise(field: ProfileField, v: unknown): any {
  if (field === 'highlights') {
    if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
    return String(v || '').split('||').map((s) => s.trim()).filter(Boolean);
  }
  if (field === 'skills') return Array.isArray(v) ? v.join(', ') : String(v ?? '');
  return v == null ? '' : String(v);
}

export function rulesFrom(profile: CandidateProfile | null): WellfoundRules {
  const raw = answersOf(profile).wellfoundRules || {};
  const cap = parseInt(raw.dailyCap, 10);
  const mins = parseInt(raw.maxRuntimeMinutes, 10);
  return {
    dailyCap: Number.isFinite(cap) && cap > 0 ? Math.min(cap, 100) : DEFAULT_RULES.dailyCap,
    autoTickTerms: typeof raw.autoTickTerms === 'boolean' ? raw.autoTickTerms : DEFAULT_RULES.autoTickTerms,
    maxRuntimeMinutes: Number.isFinite(mins) && mins > 0 ? Math.min(mins, 240) : DEFAULT_RULES.maxRuntimeMinutes,
  };
}

export function resolveProfile(profile: CandidateProfile | null): { profile: WellfoundProfile; sources: Record<ProfileField, FieldSource> } {
  const lib = scriptsLib();
  const legacy = lib.legacyEnvProfile();
  const defaults = lib.loadProfileDefaults();
  const out: Record<string, any> = {};
  const sources = {} as Record<ProfileField, FieldSource>;
  for (const field of PROFILE_FIELDS) {
    const fromDb = profileValue(profile, field);
    let value: unknown;
    let source: FieldSource = 'empty';
    if (nonEmpty(fromDb)) { value = fromDb; source = 'profile'; }
    else if (field === 'gender') { value = ''; } // never inherited: blank means "prefer not to say"/skip
    else if (nonEmpty(legacy[field])) { value = legacy[field]; source = 'legacy-env'; }
    else if (nonEmpty(defaults[field])) { value = defaults[field]; source = 'resume-defaults'; }
    out[field] = normalise(field, value);
    sources[field] = source;
  }
  return { profile: out as WellfoundProfile, sources };
}

export async function loadWellfoundSettings() {
  const profile = await ensureActiveProfile();
  const { profile: resolved, sources } = resolveProfile(profile);
  return { profileId: profile.id, profile: resolved, sources, rules: rulesFrom(profile) };
}

export function toRunnerConfig(profile: WellfoundProfile, rules: WellfoundRules) {
  return { CV: scriptsLib().buildCv({ ...profile }), rules };
}

export async function currentRunnerConfig() {
  const { profile, rules } = await loadWellfoundSettings();
  return toRunnerConfig(profile, rules);
}

/** Writes the runner config for CLI runs on this machine (scripts/wellfound/out is git-ignored). */
export function writeRunnerConfigFile(config: ReturnType<typeof toRunnerConfig>): string | null {
  try {
    const file = runnerConfigFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...config, generatedAt: new Date().toISOString() }, null, 2));
    return file;
  } catch (e: any) {
    console.warn(`[wellfound] could not write runner config: ${e.message}`);
    return null;
  }
}

export class SettingsError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const str = (v: unknown, max = 2000) => (v == null ? '' : String(v)).trim().slice(0, max);

export interface SaveSettingsInput {
  profile?: Partial<Record<ProfileField, unknown>>;
  rules?: Partial<WellfoundRules>;
  geminiKey?: string;
}

export async function saveWellfoundSettings(input: SaveSettingsInput) {
  const existing = await ensureActiveProfile();
  const p = input.profile || {};
  const columns: Prisma.CandidateProfileUpdateInput = {};
  const answers = { ...answersOf(existing) };

  for (const field of PROFILE_FIELDS) {
    if (!(field in p)) continue;
    const raw = p[field];
    if (field === 'skills') {
      const list = (Array.isArray(raw) ? raw : String(raw ?? '').split(','))
        .map((s) => String(s).trim()).filter(Boolean).slice(0, 200);
      columns.skills = { set: list };
      continue;
    }
    if (field === 'highlights') {
      answers.highlights = (Array.isArray(raw) ? raw : String(raw ?? '').split('||'))
        .map((s) => str(s, 600)).filter(Boolean).slice(0, 8);
      continue;
    }
    const col = COLUMN_FIELDS[field];
    const value = str(raw, field === 'workAuth' ? 600 : 300);
    if (col) {
      if (field === 'name') {
        if (value) columns.name = value; // name is required on the profile
      } else {
        (columns as any)[col] = value || null;
      }
    } else {
      answers[field] = value;
    }
  }

  if (input.rules) {
    const merged = { ...rulesFrom(existing), ...input.rules };
    const cap = parseInt(String(merged.dailyCap), 10);
    if (!Number.isFinite(cap) || cap < 1 || cap > 100) throw new SettingsError('dailyCap must be between 1 and 100');
    const mins = parseInt(String(merged.maxRuntimeMinutes), 10);
    answers.wellfoundRules = {
      dailyCap: cap,
      autoTickTerms: Boolean(merged.autoTickTerms),
      maxRuntimeMinutes: Number.isFinite(mins) && mins > 0 ? Math.min(mins, 240) : DEFAULT_RULES.maxRuntimeMinutes,
    };
  }

  let geminiSaved = false;
  if (typeof input.geminiKey === 'string' && input.geminiKey.trim()) {
    const key = input.geminiKey.trim();
    if (!/^[A-Za-z0-9_\-]{10,200}$/.test(key)) throw new SettingsError('That does not look like a Gemini API key.');
    const file = envFile();
    if (!fs.existsSync(file)) {
      throw new SettingsError(
        `No .env file at ${file} (the server is probably running in Docker). Add GEMINI_KEY to the root .env on the host instead.`,
        409
      );
    }
    fs.writeFileSync(file, updateEnvText(fs.readFileSync(file, 'utf8'), { GEMINI_KEY: key }));
    process.env.GEMINI_KEY = key;
    geminiSaved = true;
  }

  const updated = await prisma.candidateProfile.update({
    where: { id: existing.id },
    data: { ...columns, applicationAnswers: answers as Prisma.InputJsonValue },
  });
  const { profile, sources } = resolveProfile(updated);
  const rules = rulesFrom(updated);
  return { profile, sources, rules, geminiSaved, config: toRunnerConfig(profile, rules) };
}

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_KEY);
}
