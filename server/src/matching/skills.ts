/**
 * Skill vocabulary and word-boundary matchers.
 *
 * Plain substring matching produced false positives ("Java" in "JavaScript", "Go" in "Google",
 * "SQL" in "PostgreSQL", "Git" in "GitHub"). Every alias here is matched as a whole token: the
 * characters around it may not be letters, digits or `+ # . _ -` (so "node.js" does not yield
 * "js" and "c++" does not yield "c").
 */

export interface SkillDef {
  name: string;
  /** Case-insensitive whole-token aliases. */
  aliases: string[];
  /** Case-sensitive whole-token aliases (e.g. "Go", "React", "C"). */
  caseSensitive?: string[];
  /**
   * The case-sensitive aliases are ambiguous English words; they only count when another
   * known technology appears within ~60 characters (a skills list) — "Go, Rust or C++".
   */
  needsContext?: boolean;
  /** Text right after the alias that means it is a different thing ("React Native"). */
  notFollowedBy?: string;
}

export const SKILLS: SkillDef[] = [
  // Languages
  { name: 'JavaScript', aliases: ['javascript', 'js', 'ecmascript', 'es6'] },
  { name: 'TypeScript', aliases: ['typescript'] },
  { name: 'Java', aliases: ['java', 'java8', 'java 17', 'j2ee'] },
  { name: 'Python', aliases: ['python', 'python3'] },
  { name: 'Go', aliases: ['golang'], caseSensitive: ['Go'], needsContext: true },
  { name: 'C++', aliases: ['c++', 'cpp'] },
  { name: 'C#', aliases: ['c#', 'csharp'] },
  { name: 'C', aliases: [], caseSensitive: ['C'], needsContext: true },
  { name: 'Rust', aliases: ['rust', 'rustlang'] },
  { name: 'Ruby', aliases: ['ruby'] },
  { name: 'PHP', aliases: ['php'] },
  { name: 'Kotlin', aliases: ['kotlin'] },
  { name: 'Swift', aliases: ['swiftui'], caseSensitive: ['Swift'] },
  { name: 'Scala', aliases: ['scala'] },
  { name: 'Elixir', aliases: ['elixir'] },
  { name: 'Dart', aliases: ['dart'] },
  { name: 'Bash', aliases: ['bash', 'shell scripting'] },
  // Frontend
  { name: 'React', aliases: ['reactjs', 'react.js'], caseSensitive: ['React'], notFollowedBy: '[\\s-]*[Nn]ative' },
  { name: 'React Native', aliases: ['react native', 'react-native'] },
  { name: 'Next.js', aliases: ['next.js', 'nextjs'] },
  { name: 'Vue', aliases: ['vue', 'vue.js', 'vuejs', 'nuxt'] },
  { name: 'Angular', aliases: ['angular', 'angularjs'] },
  { name: 'Svelte', aliases: ['svelte', 'sveltekit'] },
  { name: 'Redux', aliases: ['redux'] },
  { name: 'HTML', aliases: ['html', 'html5'] },
  { name: 'CSS', aliases: ['css', 'css3', 'scss', 'sass'] },
  { name: 'Tailwind', aliases: ['tailwind', 'tailwindcss'] },
  { name: 'Flutter', aliases: ['flutter'] },
  { name: 'Android', aliases: ['android'] },
  { name: 'iOS', aliases: ['ios'] },
  // Backend
  { name: 'Node.js', aliases: ['node.js', 'nodejs', 'node js'] },
  { name: 'Express', aliases: ['express.js', 'expressjs'], caseSensitive: ['Express'], needsContext: true },
  { name: 'NestJS', aliases: ['nestjs', 'nest.js'] },
  { name: 'Django', aliases: ['django'] },
  { name: 'Flask', aliases: ['flask'] },
  { name: 'FastAPI', aliases: ['fastapi'] },
  { name: 'Spring Boot', aliases: ['spring boot', 'springboot', 'spring framework'] },
  { name: 'Ruby on Rails', aliases: ['ruby on rails', 'rails'] },
  { name: '.NET', aliases: ['.net', 'dotnet', 'asp.net'] },
  { name: 'GraphQL', aliases: ['graphql'] },
  { name: 'REST APIs', aliases: ['restful', 'rest api', 'rest apis', 'restful apis', 'rest services'] },
  { name: 'gRPC', aliases: ['grpc'] },
  { name: 'WebSockets', aliases: ['websocket', 'websockets', 'web sockets'] },
  { name: 'Microservices', aliases: ['microservices', 'microservice', 'micro-services'] },
  { name: 'Distributed Systems', aliases: ['distributed systems', 'distributed system'] },
  { name: 'Prisma', aliases: ['prisma'] },
  // Data stores & messaging
  { name: 'SQL', aliases: ['sql'] },
  { name: 'PostgreSQL', aliases: ['postgresql', 'postgres', 'psql'] },
  { name: 'MySQL', aliases: ['mysql'] },
  { name: 'MongoDB', aliases: ['mongodb', 'mongo'] },
  { name: 'Redis', aliases: ['redis'] },
  { name: 'Cassandra', aliases: ['cassandra'] },
  { name: 'DynamoDB', aliases: ['dynamodb'] },
  { name: 'Elasticsearch', aliases: ['elasticsearch', 'opensearch'] },
  { name: 'Kafka', aliases: ['kafka'] },
  { name: 'RabbitMQ', aliases: ['rabbitmq'] },
  { name: 'Spark', aliases: ['apache spark', 'pyspark', 'spark'] },
  { name: 'Airflow', aliases: ['airflow'] },
  { name: 'ClickHouse', aliases: ['clickhouse'] },
  // Cloud & infra
  { name: 'Docker', aliases: ['docker'] },
  { name: 'Kubernetes', aliases: ['kubernetes', 'k8s'] },
  { name: 'Terraform', aliases: ['terraform'] },
  { name: 'AWS', aliases: ['aws', 'amazon web services'] },
  { name: 'GCP', aliases: ['gcp', 'google cloud', 'google cloud platform'] },
  { name: 'Azure', aliases: ['azure'] },
  { name: 'Linux', aliases: ['linux', 'unix'] },
  { name: 'Git', aliases: ['git'] },
  { name: 'GitHub', aliases: ['github'] },
  { name: 'CI/CD', aliases: ['ci/cd', 'cicd', 'continuous integration', 'github actions', 'jenkins'] },
  { name: 'Nginx', aliases: ['nginx'] },
  { name: 'Prometheus', aliases: ['prometheus'] },
  { name: 'Grafana', aliases: ['grafana'] },
  // ML / data
  { name: 'Machine Learning', aliases: ['machine learning', 'ml'] },
  { name: 'Deep Learning', aliases: ['deep learning'] },
  { name: 'PyTorch', aliases: ['pytorch'] },
  { name: 'TensorFlow', aliases: ['tensorflow'] },
  { name: 'scikit-learn', aliases: ['scikit-learn', 'sklearn'] },
  { name: 'Pandas', aliases: ['pandas'] },
  { name: 'NumPy', aliases: ['numpy'] },
  { name: 'LLMs', aliases: ['llm', 'llms', 'large language models', 'genai', 'generative ai'] },
  { name: 'NLP', aliases: ['nlp', 'natural language processing'] },
  { name: 'Computer Vision', aliases: ['computer vision', 'opencv'] },
  // Testing & CS fundamentals
  { name: 'Jest', aliases: ['jest'] },
  { name: 'Selenium', aliases: ['selenium'] },
  { name: 'Playwright', aliases: ['playwright'] },
  { name: 'Data Structures & Algorithms', aliases: ['data structures', 'algorithms', 'dsa'] },
  { name: 'System Design', aliases: ['system design'] },
];

const BOUNDARY_BEFORE = '(?<![A-Za-z0-9+#._-])';
const BOUNDARY_AFTER = '(?![A-Za-z0-9+#_-]|\\.[A-Za-z0-9])';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
}

interface CompiledSkill {
  def: SkillDef;
  insensitive: RegExp | null;
  sensitive: RegExp | null;
}

function compile(def: SkillDef): CompiledSkill {
  const tail = def.notFollowedBy ? `(?!${def.notFollowedBy})` : '';
  const mk = (aliases: string[], flags: string) =>
    aliases.length
      ? new RegExp(`${BOUNDARY_BEFORE}(?:${aliases.map(escapeRe).join('|')})${BOUNDARY_AFTER}${tail}`, flags)
      : null;
  return { def, insensitive: mk(def.aliases, 'gi'), sensitive: mk(def.caseSensitive || [], 'g') };
}

const COMPILED = SKILLS.map(compile);

/** Unambiguous languages/frameworks whose presence nearby marks a "skills list" context. */
const CONTEXT_RE = new RegExp(
  `${BOUNDARY_BEFORE}(?:python|java|javascript|typescript|rust|c\\+\\+|c#|ruby|kotlin|scala|golang|node\\.?js|php|sql|react|docker|kubernetes|mongodb|postgres(?:ql)?|redis|languages?)${BOUNDARY_AFTER}`,
  'i'
);

function hasSkillContext(text: string, index: number, length: number): boolean {
  const before = text.slice(Math.max(0, index - 60), index);
  const after = text.slice(index + length, index + length + 60);
  return CONTEXT_RE.test(before) || CONTEXT_RE.test(after);
}

function matches(compiled: CompiledSkill, text: string): boolean {
  if (compiled.insensitive) {
    compiled.insensitive.lastIndex = 0;
    if (compiled.insensitive.test(text)) return true;
  }
  if (compiled.sensitive) {
    const re = compiled.sensitive;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (!compiled.def.needsContext) return true;
      // "Go" must not be the verb ("go to", "Go-to-market", "go above").
      if (compiled.def.name === 'Go' && /^\s+(?:to|above|beyond|live|through|back|ahead)\b/i.test(text.slice(m.index + 2, m.index + 12))) continue;
      if (hasSkillContext(text, m.index, m[0].length)) return true;
    }
  }
  return false;
}

const ALIAS_INDEX = new Map<string, CompiledSkill>();
for (const c of COMPILED) {
  ALIAS_INDEX.set(c.def.name.toLowerCase(), c);
  for (const a of [...c.def.aliases, ...(c.def.caseSensitive || [])]) ALIAS_INDEX.set(a.toLowerCase(), c);
}

const adHocCache = new Map<string, CompiledSkill>();

/** Resolves a free-text profile skill to a matcher (vocabulary entry or a literal token matcher). */
export function skillMatcher(skill: string): CompiledSkill {
  const key = skill.trim().toLowerCase().replace(/\s+/g, ' ');
  const known = ALIAS_INDEX.get(key);
  if (known) return known;
  let cached = adHocCache.get(key);
  if (!cached) {
    cached = compile({ name: skill.trim(), aliases: [key] });
    adHocCache.set(key, cached);
  }
  return cached;
}

/** Canonical vocabulary name for a profile skill (or the trimmed input if unknown). */
export function canonicalSkillName(skill: string): string {
  return skillMatcher(skill).def.name;
}

export function textHasSkill(text: string, skill: string): boolean {
  return matches(skillMatcher(skill), text);
}

/** All vocabulary skills mentioned in `text`, in vocabulary order. */
export function extractSkills(text: string): string[] {
  if (!text) return [];
  return COMPILED.filter((c) => matches(c, text)).map((c) => c.def.name);
}
