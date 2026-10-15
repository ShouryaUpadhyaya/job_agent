import fs from 'fs';
import crypto from 'crypto';
import { prisma } from '../db';
import { processAndUpsertJob } from '../jobs/normalization';
import { companyKey } from '../lib/company';
import { canTransition, statusForStage } from '../lib/stages';
import { ensureActiveProfile } from '../lib/profile';
import { istDateKey, parseRunnerTimestamp } from '../lib/time';
import { csvFile } from '../wellfound/paths';

/**
 * Imports the Wellfound runner's applications.csv into JobListing + JobApplication.
 * Forward-only (never downgrades a stage the user or Gmail set), idempotent, and creates no contacts.
 */

export interface WellfoundCsvRow {
  date: string;
  site: string;
  role: string;
  company: string;
  salary?: string;
  skills?: string;
  link?: string;
  jd?: string;
}

/** RFC-4180 parser: quotes, escaped quotes, multiline fields, BOM. */
export function parseWellfoundCsv(csvContent: string): WellfoundCsvRow[] {
  const src = csvContent.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  if (rows.length <= 1) return [];

  return rows.slice(1).map((cols) => {
    const role = (cols[2] || '').trim();
    const link = (cols[6] || '').trim();
    const jd = (cols[7] || '').trim();
    return {
      date: (cols[0] || '').trim(),
      site: (cols[1] || 'wellfound').trim(),
      role,
      company: cleanWellfoundCompanyName(cols[3] || '', link, role, jd),
      salary: (cols[4] || '').trim(),
      skills: (cols[5] || '').trim(),
      link,
      jd,
    };
  });
}

const NOT_A_COMPANY = /^(the )?(role|job|position|opportunity|internship|team|company|us|you|wellfound|it|this)$/i;

/**
 * Cleans company text scraped from Wellfound cards ("CertaActively HiringPromoted…51-200 Employees").
 * When the scrape captured nothing, falls back to an "About <Company>" heading in the JD. Returns ''
 * when no company can be determined (callers decide how to label it).
 */
export function cleanWellfoundCompanyName(rawCompany: string, _jobLink?: string, _role?: string, jd?: string): string {
  const cleaned = (rawCompany || '')
    .replace(/\s+/g, ' ')
    .replace(/(?:Actively\s*Hiring|Promoted|Hiring|\d+-\d+\s*Employees|Employees).*/i, '')
    .trim();
  if (cleaned) return cleaned;
  const about = (jd || '').match(/\bAbout\s+((?:[Tt]he\s+)?[A-Z][\w.&'-]*(?:\s+[A-Z0-9][\w.&'-]*){0,4})/);
  if (about) {
    const candidate = about[1].replace(/[*_]/g, '').trim();
    if (candidate.length < 40 && !NOT_A_COMPANY.test(candidate)) return candidate;
  }
  return '';
}

export function resolveWellfoundCsvPath(customPath?: string): string | null {
  const candidate = customPath || csvFile();
  try {
    return fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

export function readWellfoundCsv(customPath?: string): WellfoundCsvRow[] {
  const file = resolveWellfoundCsvPath(customPath);
  return file ? parseWellfoundCsv(fs.readFileSync(file, 'utf8')) : [];
}

/** Applications dated on the IST calendar day of `now` (rows are ISO or legacy IST-local strings). */
export function countTodayApplications(rows: Pick<WellfoundCsvRow, 'date'>[], now: Date = new Date()): number {
  const today = istDateKey(now);
  return rows.filter((r) => {
    const d = parseRunnerTimestamp(r.date);
    return d !== null && istDateKey(d) === today;
  }).length;
}

/** Stable identity of a CSV job: Wellfound's numeric job id, or a hash of company+title for link-less rows. */
export function wellfoundJobIdentity(row: Pick<WellfoundCsvRow, 'link' | 'role' | 'company'>): { externalId: string; url: string } {
  const url = ((row.link || '').match(/https?:\/\/[^\s|",]+/) || [''])[0];
  const id = url.match(/\/jobs\/(\d+)/);
  if (id) return { externalId: id[1], url };
  const hash = crypto.createHash('sha1').update(`${companyKey(row.company)}|${(row.role || '').toLowerCase().trim()}`).digest('hex').slice(0, 12);
  return { externalId: `wf-${hash}`, url: url || '' };
}

export interface SyncWellfoundApplicationsResult {
  totalRows: number;
  uniqueJobs: number;
  newImported: number;
  alreadyTracked: number;
  advanced: number;
  errors: string[];
}

interface AggregatedJob {
  externalId: string;
  url: string;
  role: string;
  company: string;
  salary: string;
  skills: string;
  jd: string;
  submittedAt: Date | null;
}

/** One entry per job: earliest submission, first known company, longest description. */
function aggregate(rows: WellfoundCsvRow[]): AggregatedJob[] {
  const byId = new Map<string, AggregatedJob>();
  for (const row of rows) {
    if (!row.role) continue;
    const { externalId, url } = wellfoundJobIdentity(row);
    const at = parseRunnerTimestamp(row.date);
    const cur = byId.get(externalId);
    if (!cur) {
      byId.set(externalId, { externalId, url, role: row.role, company: row.company, salary: row.salary || '', skills: row.skills || '', jd: row.jd || '', submittedAt: at });
      continue;
    }
    if (!cur.company && row.company) cur.company = row.company;
    if (!cur.salary && row.salary) cur.salary = row.salary;
    if (!cur.skills && row.skills) cur.skills = row.skills;
    if ((row.jd || '').length > cur.jd.length) cur.jd = row.jd || '';
    if (at && (!cur.submittedAt || at < cur.submittedAt)) cur.submittedAt = at;
  }
  return [...byId.values()];
}

export async function syncWellfoundApplicationsFromCsv(csvPath?: string): Promise<SyncWellfoundApplicationsResult> {
  const filePath = resolveWellfoundCsvPath(csvPath);
  if (!filePath) {
    return { totalRows: 0, uniqueJobs: 0, newImported: 0, alreadyTracked: 0, advanced: 0, errors: ['applications.csv not found'] };
  }
  const rows = parseWellfoundCsv(fs.readFileSync(filePath, 'utf8'));
  const jobs = aggregate(rows);
  const profile = await ensureActiveProfile();
  const result: SyncWellfoundApplicationsResult = {
    totalRows: rows.length, uniqueJobs: jobs.length, newImported: 0, alreadyTracked: 0, advanced: 0, errors: [],
  };

  for (const job of jobs) {
    try {
      let company = job.company;
      if (!company) {
        const existingListing = await prisma.jobListing.findUnique({
          where: { externalId_source: { externalId: job.externalId, source: 'wellfound' } },
        });
        company = existingListing?.company || 'Unknown company';
      }
      const key = companyKey(company);
      const { listing } = await processAndUpsertJob(
        {
          externalId: job.externalId,
          source: 'wellfound',
          title: job.role,
          company,
          url: job.url || `https://wellfound.com/jobs`,
          description: job.jd || `Applied on Wellfound: ${job.role} at ${company}.`,
          tags: job.skills ? job.skills.split(';').map((s) => s.trim()).filter(Boolean) : [],
        },
        profile
      );

      let existing = await prisma.jobApplication.findFirst({
        where: { jobListingId: listing.id, candidateProfileId: profile.id },
      });
      if (!existing && key) {
        // Same role at the same company tracked from another source (manual, email)
        existing = await prisma.jobApplication.findFirst({
          where: {
            candidateProfileId: profile.id,
            companyKey: key,
            jobListing: { title: { equals: job.role, mode: 'insensitive' } },
          },
        });
      }

      if (existing) {
        result.alreadyTracked++;
        const data: Record<string, unknown> = {};
        if (canTransition(existing.stage, 'APPLIED', 'wellfound')) {
          data.stage = 'APPLIED';
          data.status = statusForStage('APPLIED');
          data.isApproved = true;
          result.advanced++;
        }
        if (!existing.submittedAt && job.submittedAt) data.submittedAt = job.submittedAt;
        if (!existing.source) data.source = 'wellfound';
        if (!existing.companyKey && key) data.companyKey = key;
        if (!existing.appliedUrl && job.url) data.appliedUrl = job.url;
        if (Object.keys(data).length) await prisma.jobApplication.update({ where: { id: existing.id }, data });
        continue;
      }

      await prisma.jobApplication.create({
        data: {
          jobListingId: listing.id,
          candidateProfileId: profile.id,
          stage: 'APPLIED',
          status: statusForStage('APPLIED'),
          isApproved: true,
          source: 'wellfound',
          companyKey: key,
          appliedUrl: job.url || null,
          submittedAt: job.submittedAt ?? new Date(),
          notes: `Submitted via Wellfound auto-apply${job.submittedAt ? ` on ${istDateKey(job.submittedAt)} (IST)` : ''}.${job.salary ? ` Salary: ${job.salary}` : ''}`,
        },
      });
      result.newImported++;
    } catch (err: any) {
      result.errors.push(`"${job.role} @ ${job.company || '?'}": ${err.message}`);
    }
  }
  return result;
}
