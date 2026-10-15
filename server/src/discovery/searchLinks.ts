/**
 * Prefilled job-search links built from the profile. The user opens them in their own browser;
 * the server never requests any of these URLs (LinkedIn/Naukri forbid automated access).
 */

export interface SearchLink {
  id: string;
  site: string;
  label: string;
  url: string;
  description: string;
  group: 'job-boards' | 'ats-search' | 'social';
}

export interface SearchLinkProfile {
  targetRole?: string | null;
  skills?: string[];
  preferredLocations?: string[];
  remoteOk?: boolean | null;
  targetGradYear?: number | null;
}

/** LinkedIn's geoId for India. */
export const LINKEDIN_INDIA_GEO_ID = '102713980';
const WEEK_SECONDS = 604800;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

function query(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

export function buildSearchLinks(profile: SearchLinkProfile, topSkills: string[] = []): SearchLink[] {
  const role = (profile.targetRole || 'Software Engineer Intern').trim();
  const internship = /intern/i.test(role);
  const baseRole = role.replace(/\binterns?(hip)?\b/gi, '').replace(/\s+/g, ' ').trim() || 'Software Engineer';
  const roleKeywords = internship ? `${baseRole} intern` : role;
  const preferred = (profile.preferredLocations || []).filter(Boolean);
  const india = preferred.length === 0 || preferred.some((p) => /india/i.test(p));
  const city = preferred.find((p) => !/india|remote/i.test(p));
  const remote = profile.remoteOk !== false;
  const skills = (topSkills.length ? topSkills : profile.skills || []).slice(0, 3);
  const skillOr = skills.length ? ` (${skills.map((s) => `"${s}"`).join(' OR ')})` : '';
  const locationOr = [india ? '"India"' : '', city ? `"${city}"` : '', remote ? '"Remote"' : ''].filter(Boolean).join(' OR ');
  const links: SearchLink[] = [];

  // LinkedIn Jobs: f_E=1 internship, f_E=2 entry level; f_TPR past week; f_WT=2 remote.
  links.push({
    id: 'linkedin-india',
    site: 'LinkedIn',
    label: `LinkedIn: ${roleKeywords} in ${city || 'India'} (past week)`,
    url: `https://www.linkedin.com/jobs/search/?${query({
      keywords: roleKeywords,
      location: city || 'India',
      ...(city ? {} : { geoId: LINKEDIN_INDIA_GEO_ID }),
      f_E: internship ? '1' : '1,2',
      f_TPR: `r${WEEK_SECONDS}`,
      sortBy: 'DD',
    })}`,
    description: 'Internship experience level, posted in the last 7 days, newest first.',
    group: 'job-boards',
  });
  if (remote) {
    links.push({
      id: 'linkedin-remote',
      site: 'LinkedIn',
      label: `LinkedIn: remote ${roleKeywords} (past week)`,
      url: `https://www.linkedin.com/jobs/search/?${query({
        keywords: roleKeywords,
        location: 'India',
        geoId: LINKEDIN_INDIA_GEO_ID,
        f_E: internship ? '1' : '1,2',
        f_WT: '2',
        f_TPR: `r${WEEK_SECONDS}`,
        sortBy: 'DD',
      })}`,
      description: 'Remote roles open to India, last 7 days.',
      group: 'job-boards',
    });
  }
  if (skills.length) {
    links.push({
      id: 'linkedin-skills',
      site: 'LinkedIn',
      label: `LinkedIn: ${skills.join(' / ')} internships`,
      url: `https://www.linkedin.com/jobs/search/?${query({
        keywords: `${skills.join(' OR ')} intern`,
        location: 'India',
        geoId: LINKEDIN_INDIA_GEO_ID,
        f_E: '1',
        f_TPR: `r${WEEK_SECONDS}`,
      })}`,
      description: 'Your top resume skills, internship level, last 7 days.',
      group: 'job-boards',
    });
  }

  // Naukri: experience=0 (fresher), jobAge=7 (days).
  links.push({
    id: 'naukri',
    site: 'Naukri',
    label: `Naukri: ${internship ? 'internships' : 'fresher jobs'} for ${baseRole}`,
    url: `https://www.naukri.com/${slug(internship ? `${baseRole} internship` : baseRole)}-jobs?${query({
      k: internship ? `${baseRole} internship` : baseRole,
      experience: '0',
      jobAge: '7',
    })}`,
    description: 'Fresher experience filter, posted in the last 7 days.',
    group: 'job-boards',
  });

  links.push({
    id: 'internshala',
    site: 'Internshala',
    label: `Internshala: ${skills[0] || baseRole} internships`,
    url: `https://internshala.com/internships/keywords-${slug(skills[0] || baseRole)}/`,
    description: 'Internshala keyword search.',
    group: 'job-boards',
  });
  if (remote) {
    links.push({
      id: 'internshala-wfh',
      site: 'Internshala',
      label: 'Internshala: work-from-home software internships',
      url: 'https://internshala.com/internships/work-from-home-software-development-internships/',
      description: 'Remote internships on Internshala.',
      group: 'job-boards',
    });
  }

  links.push({
    id: 'wellfound',
    site: 'Wellfound',
    label: `Wellfound: ${baseRole} roles in India`,
    url: `https://wellfound.com/role/l/${slug(baseRole)}/india`,
    description: 'Startup roles by role and location (filter for internships on the page).',
    group: 'job-boards',
  });
  if (remote) {
    links.push({
      id: 'wellfound-remote',
      site: 'Wellfound',
      label: `Wellfound: remote ${baseRole} roles`,
      url: `https://wellfound.com/role/r/${slug(baseRole)}`,
      description: 'Remote startup roles.',
      group: 'job-boards',
    });
  }

  const google = (q: string) => `https://www.google.com/search?${query({ q, tbs: 'qdr:w' })}`;
  links.push({
    id: 'instahyre',
    site: 'Instahyre',
    label: 'Instahyre (via Google, past week)',
    url: google(`site:instahyre.com ${roleKeywords}${skillOr}`),
    description: 'Instahyre listings indexed in the past week.',
    group: 'job-boards',
  });

  const atsBoards: [string, string, string][] = [
    ['greenhouse', 'Greenhouse', 'site:boards.greenhouse.io OR site:job-boards.greenhouse.io'],
    ['lever', 'Lever', 'site:jobs.lever.co'],
    ['ashby', 'Ashby', 'site:jobs.ashbyhq.com'],
    ['workable', 'Workable', 'site:apply.workable.com'],
    ['smartrecruiters', 'SmartRecruiters', 'site:jobs.smartrecruiters.com'],
  ];
  for (const [id, name, site] of atsBoards) {
    links.push({
      id: `google-${id}`,
      site: name,
      label: `${name} boards: ${internship ? 'internships' : roleKeywords} (past week)`,
      url: google(`(${site}) (${internship ? '"intern" OR "internship"' : `"${baseRole}"`})${locationOr ? ` (${locationOr})` : ''}${skillOr}`),
      description: `Google search of ${name}-hosted job pages indexed in the past week.`,
      group: 'ats-search',
    });
  }

  const batch = profile.targetGradYear ? ` (${profile.targetGradYear} OR ${profile.targetGradYear - 1} OR "${profile.targetGradYear} batch")` : '';
  links.push({
    id: 'x-search',
    site: 'X',
    label: 'X: internship hiring posts (live)',
    url: `https://x.com/search?${query({
      q: `(internship OR intern) (hiring OR apply)${batch} ${india ? 'india ' : ''}min_faves:20`,
      f: 'live',
    })}`,
    description: 'Recent popular posts about internship openings.',
    group: 'social',
  });

  return links;
}
