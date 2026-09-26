/**
 * The failures a JUnit XML report records.
 *
 * JUnit XML is the one result format nearly every test runner writes, natively
 * or through a reporter - Vitest, Jest, pytest, `go test` through
 * go-junit-report, `cargo nextest`, `dotnet test` through its logger - so a
 * probe that reads it reads them all (ADR-0007). This reads the part of the
 * format a probe needs: which test cases failed or errored, and with what
 * message. It is not an XML parser; it is a tokenizer for elements and
 * attributes, entity-aware, that skips everything else, and it refuses text
 * it cannot read rather than guessing at it.
 */

export interface JUnitCase {
  readonly name: string;
  readonly classname: string;
  readonly outcome: 'passed' | 'failed' | 'errored' | 'skipped';
  /** The failure's or error's message and body, joined. */
  readonly message: string;
}

export type JUnitRead = { readonly ok: true; readonly cases: readonly JUnitCase[] } | { readonly ok: false; readonly error: string };

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Replaces the five named entities and numeric references. An unknown entity stays as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x')) {
      const point = Number.parseInt(body.slice(2), 16);
      return point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    }
    if (body.startsWith('#')) {
      const point = Number.parseInt(body.slice(1), 10);
      return point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

function attributes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const pattern = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    out[match[1] as string] = decodeEntities(match[3] ?? match[4] ?? '');
  }
  return out;
}

interface Tag {
  readonly kind: 'open' | 'close' | 'self';
  readonly name: string;
  readonly attributes: Record<string, string>;
  readonly start: number;
  readonly end: number;
}

/** The tags of a document, comments, CDATA and declarations skipped, in one pass. */
function tags(xml: string): Tag[] | string {
  const out: Tag[] = [];
  let i = 0;
  while (i < xml.length) {
    const open = xml.indexOf('<', i);
    if (open < 0) break;
    if (xml.startsWith('<!--', open)) {
      const close = xml.indexOf('-->', open + 4);
      if (close < 0) return 'a comment is never closed';
      i = close + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', open)) {
      const close = xml.indexOf(']]>', open + 9);
      if (close < 0) return 'a CDATA section is never closed';
      i = close + 3;
      continue;
    }
    if (xml.startsWith('<?', open) || xml.startsWith('<!', open)) {
      const close = xml.indexOf('>', open);
      if (close < 0) return 'a declaration is never closed';
      i = close + 1;
      continue;
    }
    let close = open + 1;
    let quote: string | null = null;
    for (; close < xml.length; close += 1) {
      const ch = xml.charAt(close);
      if (quote !== null) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
    }
    if (close >= xml.length) return 'a tag is never closed';
    const body = xml.slice(open + 1, close);
    const closing = body.startsWith('/');
    const self = body.endsWith('/');
    const name = /^\/?\s*([A-Za-z_:][\w:.-]*)/.exec(body)?.[1];
    if (name === undefined) return `"<${body.slice(0, 20)}" is not a tag`;
    out.push({
      kind: closing ? 'close' : self ? 'self' : 'open',
      name,
      attributes: closing ? {} : attributes(body.slice(name.length + 1)),
      start: open,
      end: close + 1,
    });
    i = close + 1;
  }
  return out;
}

/**
 * The text between two offsets, tags dropped and entities decoded outside
 * CDATA, and CDATA kept as written: a stack trace's `Object.<anonymous>` or
 * `a < b` inside CDATA is text, not a tag.
 */
function innerText(xml: string, from: number, to: number): string {
  const slice = xml.slice(from, to);
  const markup = (text: string): string => decodeEntities(text.replace(/<[^>]*>/g, ''));
  let out = '';
  let last = 0;
  for (const match of slice.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
    out += markup(slice.slice(last, match.index)) + (match[1] as string);
    last = match.index + match[0].length;
  }
  return (out + markup(slice.slice(last))).trim();
}

/** Reads the test cases of a JUnit XML report, nested suites included. */
export function readJUnit(xml: string): JUnitRead {
  const list = tags(xml);
  if (typeof list === 'string') return { ok: false, error: list };
  if (!list.some((tag) => tag.name === 'testsuite' || tag.name === 'testsuites')) {
    return { ok: false, error: 'no <testsuite> element: this is not a JUnit report' };
  }
  const cases: JUnitCase[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const tag = list[i] as Tag;
    if (tag.name !== 'testcase' || tag.kind === 'close') continue;
    const name = tag.attributes['name'] ?? '';
    const classname = tag.attributes['classname'] ?? '';
    if (tag.kind === 'self') {
      cases.push({ name, classname, outcome: 'passed', message: '' });
      continue;
    }
    let outcome: JUnitCase['outcome'] = 'passed';
    const messages: string[] = [];
    let j = i + 1;
    for (; j < list.length; j += 1) {
      const inner = list[j] as Tag;
      if (inner.name === 'testcase' && inner.kind === 'close') break;
      if (inner.kind === 'close') continue;
      if (inner.name === 'failure' || inner.name === 'error') {
        outcome = inner.name === 'failure' ? 'failed' : outcome === 'failed' ? 'failed' : 'errored';
        const message = inner.attributes['message'];
        if (message !== undefined && message !== '') messages.push(message);
        if (inner.kind === 'open') {
          const end = list.findIndex((candidate, k) => k > j && candidate.name === inner.name && candidate.kind === 'close');
          if (end > j) {
            const body = innerText(xml, inner.end, (list[end] as Tag).start);
            if (body !== '') messages.push(body);
          }
        }
      } else if (inner.name === 'skipped' && outcome === 'passed') {
        outcome = 'skipped';
      }
    }
    if (j >= list.length) return { ok: false, error: `test case "${name}" is never closed` };
    cases.push({ name, classname, outcome, message: messages.join('\n') });
    i = j;
  }
  return { ok: true, cases };
}
