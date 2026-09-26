/**
 * Which brief a branch is working on, read from its name.
 *
 * A round runs on a branch, and naming the branch after the brief is the one
 * convention every repository that runs agents on briefs already has. Reading
 * it from there keeps the harness stateless: no file says which brief is
 * active, so no file can say it wrongly (ADR-0004).
 *
 * A template is a branch name with `{id}` where the id goes and `*` for any
 * run of characters other than `/`: `brief/{id}`, `*\/brief-{id}`. The id is
 * the longest run of letters and digits at that point, and must be followed
 * by the end of the name or a separator - so `brief/012-rotate-tokens` names
 * 012, and `brief/012x` names 012x, never 012.
 */

const SEPARATORS = new Set(['-', '_', '/', '.']);

function isIdChar(ch: string): boolean {
  return /^[A-Za-z0-9]$/.test(ch);
}

/**
 * The offsets in `name` at which a template prefix can end, by dynamic
 * programming over prefix and name, so a template of many stars costs their
 * product and never an exponent.
 */
function prefixEnds(prefix: string, name: string): number[] {
  // reach[j]: the prefix read so far can end at name offset j.
  let reach: boolean[] = new Array<boolean>(name.length + 1).fill(false);
  reach[0] = true;
  for (const token of prefix) {
    const next = new Array<boolean>(name.length + 1).fill(false);
    if (token === '*') {
      let open = false;
      for (let j = 0; j <= name.length; j += 1) {
        if (reach[j]) open = true;
        if (open) next[j] = true;
        if (name.charAt(j) === '/') open = false;
      }
    } else {
      for (let j = 0; j < name.length; j += 1) if (reach[j] && name.charAt(j) === token) next[j + 1] = true;
    }
    reach = next;
  }
  const ends: number[] = [];
  reach.forEach((ok, j) => {
    if (ok) ends.push(j);
  });
  return ends;
}

/** Why a template cannot be used, or `null`. */
export function templateError(template: string): string | null {
  const count = template.split('{id}').length - 1;
  if (count !== 1) return `"${template}" must contain {id} exactly once`;
  if (!template.endsWith('{id}')) return `"${template}" must end with {id}; whatever follows the id is the branch's own`;
  return null;
}

/** The brief id a branch name carries under one template, or `null`. */
export function idFromBranch(template: string, name: string): string | null {
  if (templateError(template) !== null) return null;
  const prefix = template.slice(0, -'{id}'.length);
  for (const start of prefixEnds(prefix, name)) {
    let end = start;
    while (end < name.length && isIdChar(name.charAt(end))) end += 1;
    if (end === start) continue;
    if (end < name.length && !SEPARATORS.has(name.charAt(end))) continue;
    return name.slice(start, end);
  }
  return null;
}

/** The first template that yields an id, in order. */
export function briefIdFromBranch(templates: readonly string[], name: string): string | null {
  for (const template of templates) {
    const id = idFromBranch(template, name);
    if (id !== null) return id;
  }
  return null;
}

/**
 * Whether two ids name the same brief: equal as written, or equal as numbers
 * when both are all digits, since a branch says `brief/12` of a brief whose
 * file says `012`.
 */
export function sameId(a: string, b: string): boolean {
  if (a === b) return true;
  return /^\d+$/.test(a) && /^\d+$/.test(b) && BigInt(a) === BigInt(b);
}
