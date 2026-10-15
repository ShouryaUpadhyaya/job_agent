/**
 * .env editing that keeps everything it doesn't own: comments, ordering and unknown keys survive,
 * and values are quoted/escaped so a value can never inject another line.
 */

const KEY_RE = /^[A-Z][A-Z0-9_]*$/;
const LINE_RE = /^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=/;

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
      v = v.slice(1, -1).replace(/\\(["\\n])/g, (_s, c: string) => (c === 'n' ? '\n' : c));
    } else if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

export function formatEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@,+-]*$/.test(value)) return value;
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"';
}

/** Returns `text` with `updates` applied (null removes the key). Unknown keys and comments are untouched. */
export function updateEnvText(text: string, updates: Record<string, string | null>): string {
  for (const key of Object.keys(updates)) {
    if (!KEY_RE.test(key)) throw new Error(`Invalid env key: ${key}`);
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.length ? text.split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const done = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(LINE_RE);
    const key = m && !line.trim().startsWith('#') ? m[1] : null;
    if (key && key in updates) {
      if (done.has(key)) continue; // drop duplicate definitions of keys we manage
      done.add(key);
      const v = updates[key];
      if (v !== null) out.push(`${key}=${formatEnvValue(v)}`);
      continue;
    }
    out.push(line);
  }
  for (const [key, v] of Object.entries(updates)) {
    if (!done.has(key) && v !== null) out.push(`${key}=${formatEnvValue(v)}`);
  }
  return out.join(eol) + eol;
}
