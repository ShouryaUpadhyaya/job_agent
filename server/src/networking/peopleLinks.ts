/**
 * "Find people at <company>" links. These are search URLs the user opens in their own
 * browser; the server never requests LinkedIn, Google or X.
 */
import { Persona } from './constants';
import { mentionsVit } from './parse';

export type PeopleLinkGroup = 'ALUMNI' | Exclude<Persona, 'OTHER' | 'MANAGER'> | 'GENERAL';

export interface PeopleLink {
  id: string;
  group: PeopleLinkGroup;
  site: 'LinkedIn' | 'Google' | 'X' | 'GitHub';
  label: string;
  url: string;
  description: string;
}

const linkedinPeople = (keywords: string) =>
  `https://www.linkedin.com/search/results/people/?${new URLSearchParams({ keywords, origin: 'GLOBAL_SEARCH_HEADER' })}`;
const google = (q: string) => `https://www.google.com/search?${new URLSearchParams({ q })}`;
const xPeople = (q: string) => `https://x.com/search?${new URLSearchParams({ q, f: 'user' })}`;

/** School search terms from the profile's school (VIT expands to its common spellings). */
export function schoolTerms(school: string | null | undefined): string[] {
  const s = (school || '').trim();
  if (!s) return [];
  if (mentionsVit(s)) return ['VIT Vellore', 'Vellore Institute of Technology'];
  return [s];
}

export function buildPeopleLinks(
  companyRaw: string,
  opts: { school?: string | null; githubOrg?: string | null } = {}
): PeopleLink[] {
  const company = companyRaw.trim();
  const q = `"${company.replace(/"/g, '')}"`;
  const terms = schoolTerms(opts.school);
  const links: PeopleLink[] = [];

  if (terms.length) {
    for (const [i, term] of terms.entries()) {
      links.push({
        id: `linkedin-alumni-${i}`,
        group: 'ALUMNI',
        site: 'LinkedIn',
        label: `LinkedIn: ${company} + ${term}`,
        url: linkedinPeople(`${company} ${term}`),
        description: 'People at the company who list your school. Alumni reply most often.',
      });
    }
    const schoolOr = terms.map((t) => `"${t}"`).join(' OR ');
    links.push({
      id: 'google-alumni',
      group: 'ALUMNI',
      site: 'Google',
      label: `Google: LinkedIn profiles at ${company} mentioning your school`,
      url: google(`site:linkedin.com/in ${q} (${schoolOr}${mentionsVit(opts.school) ? ' OR "VIT"' : ''})`),
      description: 'Google X-ray search over public LinkedIn profiles.',
    });
  }

  const personaSearches: { group: PeopleLinkGroup; key: string; words: string; label: string; description: string }[] = [
    { group: 'ENGINEER', key: 'swe', words: 'software engineer', label: 'software engineers', description: 'Engineers can refer you to their own team.' },
    { group: 'FULLSTACK', key: 'fullstack', words: 'full stack', label: 'full-stack engineers', description: 'Full-stack and product engineers.' },
    { group: 'RECRUITER', key: 'recruiter', words: 'recruiter OR "talent acquisition"', label: 'recruiters / talent', description: 'Useful when they hire for the exact role.' },
    { group: 'FOUNDER_CXO', key: 'founder', words: 'CTO OR founder OR co-founder', label: 'CTO / founders', description: 'Best at small startups.' },
  ];
  for (const p of personaSearches) {
    links.push({
      id: `linkedin-${p.key}`,
      group: p.group,
      site: 'LinkedIn',
      label: `LinkedIn: ${p.label} at ${company}`,
      url: linkedinPeople(`${company} ${p.words}`),
      description: p.description,
    });
  }
  links.push({
    id: 'google-engineers',
    group: 'ENGINEER',
    site: 'Google',
    label: `Google: engineer profiles at ${company}`,
    url: google(`site:linkedin.com/in ${q} ("software engineer" OR "SDE" OR "developer")`),
    description: 'Google X-ray search over public LinkedIn profiles.',
  });
  links.push({
    id: 'google-recruiters',
    group: 'RECRUITER',
    site: 'Google',
    label: `Google: recruiter profiles at ${company}`,
    url: google(`site:linkedin.com/in ${q} ("recruiter" OR "talent acquisition")`),
    description: 'Google X-ray search over public LinkedIn profiles.',
  });

  links.push({
    id: 'x-people',
    group: 'GENERAL',
    site: 'X',
    label: `X: people mentioning ${company}`,
    url: xPeople(`${company} engineer`),
    description: 'X people search; many engineers list their employer in their bio.',
  });

  links.push({
    id: 'github-org',
    group: 'GENERAL',
    site: 'GitHub',
    label: opts.githubOrg ? `GitHub: ${opts.githubOrg} organisation` : `GitHub: search organisations named ${company}`,
    url: opts.githubOrg
      ? `https://github.com/${encodeURIComponent(opts.githubOrg)}`
      : `https://github.com/search?${new URLSearchParams({ q: `${company} type:org`, type: 'users' })}`,
    description: 'Public members and contributors are listed in the GitHub panel.',
  });

  return links;
}
