import fs from 'fs';
import path from 'path';
import { prisma } from '../db';
import { extractWellfoundJobId, normalizeWellfoundJob } from '../connectors/wellfound';
import { processAndUpsertJob } from '../jobs/normalization';

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

/**
 * Robust CSV parser that handles quotes, escaped quotes, multiline fields, and commas.
 */
export function parseWellfoundCsv(csvContent: string): WellfoundCsvRow[] {
  // Strip UTF-8 BOM if present
  const cleanContent = csvContent.replace(/^\uFEFF/, '').trim();
  if (!cleanContent) return [];

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;

  for (let i = 0; i < cleanContent.length; i++) {
    const char = cleanContent[i];
    const nextChar = cleanContent[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        // Escaped quote ("")
        currentField += '"';
        i++;
      } else {
        // Toggle quote
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      currentRow.push(currentField);
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !insideQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++; // Skip \r\n
      }
      currentRow.push(currentField);
      if (currentRow.length > 0 && currentRow.some((f) => f.trim().length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  // Final field if any
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some((f) => f.trim().length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length <= 1) return [];

  // Header is row 0: "Date","Site","Role","Company","CTC/Salary","Skills","Job Link","Job Description"
  const parsedRows: WellfoundCsvRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    const rawRole = (cols[2] || '').trim();
    const rawCompany = (cols[3] || '').trim();
    const link = (cols[6] || '').trim();
    const jd = (cols[7] || '').trim();
    const cleanCompany = cleanWellfoundCompanyName(rawCompany, link, rawRole, jd);

    parsedRows.push({
      date: (cols[0] || '').trim(),
      site: (cols[1] || 'wellfound').trim(),
      role: rawRole,
      company: cleanCompany,
      salary: (cols[4] || '').trim(),
      skills: (cols[5] || '').trim(),
      link: link,
      jd: jd,
    });
  }

  return parsedRows;
}

/**
 * Known mapping of Wellfound job IDs to real company names,
 * used when the scraper captured the global sticky page banner (e.g. "Certa...")
 * instead of the job-specific company.
 */
export const WELLFOUND_KNOWN_COMPANIES: Record<string, string> = {
  '3263581': 'Decentro',
  '4824501': 'The Date Crew',
  '3147916': 'Kyoto Creative',
  '3299524': 'Dobbe AI',
  '3693386': 'WhatBytes',
  '3029813': 'WhatBytes',
  '4746834': 'Runmivo',
  '3534348': 'Auto Wisdom',
  '4084234': 'Auto Wisdom',
  '4756722': 'Bitslap IT',
  '4751410': 'AlwayzON',
  '3783479': 'vaiu.ai',
  '3610503': 'Modulus Seventeen',
  '4829680': 'AVYAM LABS',
  '4827953': 'CloudSEK',
  '3327406': 'Wubble.AI',
  '4704098': 'MAVR',
};

/**
 * Cleans noisy company headers captured from Wellfound HTML text (e.g. "CertaActively HiringPromoted...")
 * and resolves the real company name using job link metadata if the global header was captured.
 */
export function cleanWellfoundCompanyName(
  rawCompany: string,
  jobLink?: string,
  role?: string,
  jd?: string
): string {
  // 1. If job link contains a known Wellfound job ID, resolve real company
  if (jobLink) {
    const idMatch = jobLink.match(/\/jobs\/(\d+)/);
    if (idMatch && WELLFOUND_KNOWN_COMPANIES[idMatch[1]]) {
      return WELLFOUND_KNOWN_COMPANIES[idMatch[1]];
    }
  }

  // 2. Check JD for "About <Company>"
  if (jd) {
    const aboutMatch = jd.match(/\*?About (?:The )?([A-Za-z0-9\s.]+?)\s*\*?\s*(?:We’re|We are|is |—|-|\n|$)/i);
    if (aboutMatch && aboutMatch[1].trim().length < 40) {
      const candidate = aboutMatch[1].replace(/[*_]/g, '').trim();
      if (!/the job|the role|us|wellfound/i.test(candidate)) {
        return candidate;
      }
    }
  }

  // 3. Fallback for specific unlinked roles
  if (role && role.includes('Software Engineer Intern') && (!jobLink || jobLink.includes('Part-time'))) {
    return 'UnQue Cloudbook';
  }

  if (!rawCompany) return 'Unknown Company';

  // 4. Clean noisy text scraped from Wellfound headers
  let cleaned = rawCompany
    .replace(/\s+/g, ' ')
    .replace(/(?:Actively\s*Hiring|Promoted|Hiring|Employees|\d+-\d+\s*Employees).*/i, '')
    .trim();

  // If cleaning resulted in empty string, fallback to first word or raw
  if (!cleaned) {
    cleaned = rawCompany.split(/[\s,]+/)[0] || 'Unknown Company';
  }
  return cleaned;
}

export interface SyncWellfoundApplicationsResult {
  totalRows: number;
  newImported: number;
  alreadyTracked: number;
  contactsCreated: number;
  errors: string[];
}

/**
 * Resolves the location of applications.csv across local workspace and Docker environments.
 */
export function resolveWellfoundCsvPath(customPath?: string): string | null {
  if (customPath && fs.existsSync(customPath)) {
    return customPath;
  }
  const candidates = [
    process.env.WELLFOUND_APPLICATIONS_CSV,
    path.resolve(__dirname, '../../../wellfound_autoApply/applications.csv'),
    path.resolve(__dirname, '../../wellfound_autoApply/applications.csv'),
    path.resolve(__dirname, '../../../applications.csv'),
    path.resolve(process.cwd(), 'wellfound_autoApply/applications.csv'),
    path.resolve(process.cwd(), 'applications.csv'),
    '/app/wellfound_autoApply/applications.csv',
    '/app/applications.csv',
  ].filter(Boolean) as string[];

  for (const cand of candidates) {
    if (fs.existsSync(cand)) {
      try {
        if (fs.statSync(cand).isFile()) {
          return cand;
        }
      } catch (e) {}
    }
  }
  return null;
}

/**
 * Syncs all applied jobs from applications.csv into JobListing, JobApplication (stage=APPLIED),
 * and generates matching networking contacts.
 */
export async function syncWellfoundApplicationsFromCsv(
  csvPath?: string
): Promise<SyncWellfoundApplicationsResult> {
  const filePath = resolveWellfoundCsvPath(csvPath);

  if (!filePath || !fs.existsSync(filePath)) {
    return {
      totalRows: 0,
      newImported: 0,
      alreadyTracked: 0,
      contactsCreated: 0,
      errors: [`applications.csv not found (searched standard workspace and Docker paths)`],
    };
  }

  const csvContent = fs.readFileSync(filePath, 'utf8');
  const rows = parseWellfoundCsv(csvContent);

  let profile = await prisma.candidateProfile.findFirst();
  if (!profile) {
    profile = await prisma.candidateProfile.create({
      data: {
        name: 'Default Candidate',
        email: 'candidate@example.com',
        targetRole: 'Software Engineer',
      },
    });
  }
  let newImported = 0;
  let alreadyTracked = 0;
  let contactsCreated = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      if (!row.role || !row.company) continue;

      const cleanCompany = cleanWellfoundCompanyName(row.company, row.link, row.role, row.jd);
      const jobUrl = row.link && row.link.startsWith('http')
        ? row.link.split(/\s*\|\s*/)[0].trim()
        : `https://wellfound.com/jobs/${Math.abs(row.role.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0))}`;

      const externalId = extractWellfoundJobId(jobUrl);

      // Normalize and upsert job listing
      const rawPayload = normalizeWellfoundJob({
        url: jobUrl,
        title: row.role,
        company: cleanCompany,
        description: row.jd || `Auto-applied role: ${row.role} at ${cleanCompany}`,
        salary: row.salary,
        tags: row.skills ? row.skills.split(';').map((s) => s.trim()) : [],
      });

      const { listing } = await processAndUpsertJob(rawPayload, profile);

      // Parse submission date
      let submittedDate = new Date();
      if (row.date) {
        const parsedD = new Date(row.date);
        if (!isNaN(parsedD.getTime())) {
          submittedDate = parsedD;
        }
      }

      // Check if job application already tracked
      const existingApp = await prisma.jobApplication.findFirst({
        where: {
          jobListingId: listing.id,
          candidateProfileId: profile?.id || undefined,
        },
      });

      if (existingApp) {
        alreadyTracked++;
        // Update stage to APPLIED if still in lower stage
        if (existingApp.stage !== 'APPLIED') {
          await prisma.jobApplication.update({
            where: { id: existingApp.id },
            data: {
              stage: 'APPLIED',
              status: 'APPLIED',
              isApproved: true,
              submittedAt: submittedDate,
            },
          });
        }
      } else if (profile) {
        await prisma.jobApplication.create({
          data: {
            jobListingId: listing.id,
            candidateProfileId: profile.id,
            stage: 'APPLIED',
            status: 'APPLIED',
            isApproved: true,
            notes: `Submitted via Wellfound AutoApply on ${row.date || 'today'}. Salary: ${row.salary || 'N/A'}`,
            submittedAt: submittedDate,
          },
        });
        newImported++;
      }

      // Auto-generate target networking contacts for this company if none exist
      const existingContacts = await prisma.networkingContact.findMany({
        where: { company: cleanCompany },
      });

      if (existingContacts.length === 0) {
        const targetSearchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(
          cleanCompany + ' software engineer VIT Vellore'
        )}`;
        const recruiterSearchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(
          cleanCompany + ' recruiter campus talent'
        )}`;

        await prisma.networkingContact.createMany({
          data: [
            {
              name: `Engineering Team (${cleanCompany})`,
              company: cleanCompany,
              role: 'Software Engineer / Tech Lead',
              profileUrl: targetSearchUrl,
              headline: `Engineer at ${cleanCompany}`,
              team: 'Engineering',
              vitAlumni: true,
              outreachAngle: `Applied for ${row.role}. Connect to ask about engineering team culture and workflow.`,
              relevanceScore: 95,
              targetJobId: listing.id,
              status: 'RESEARCHED',
              notes: `Auto-generated follow-up target after Wellfound application for ${row.role}.`,
            },
            {
              name: `Talent Partner (${cleanCompany})`,
              company: cleanCompany,
              role: 'Recruiter / Talent Acquisition',
              profileUrl: recruiterSearchUrl,
              headline: `Talent Acquisition at ${cleanCompany}`,
              team: 'People / Recruiting',
              vitAlumni: false,
              outreachAngle: `Submitted application for ${row.role}. Inquire about candidate review timeline.`,
              relevanceScore: 90,
              targetJobId: listing.id,
              status: 'RESEARCHED',
              notes: `Recruiter contact for ${cleanCompany} application status.`,
            },
          ],
        });
        contactsCreated += 2;
      }
    } catch (rowErr: any) {
      errors.push(`Error syncing row "${row.role} @ ${row.company}": ${rowErr.message}`);
    }
  }

  return {
    totalRows: rows.length,
    newImported,
    alreadyTracked,
    contactsCreated,
    errors,
  };
}
