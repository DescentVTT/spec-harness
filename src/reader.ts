/**
 * The document reader, on spec-core's Markdown scanner: nothing inside code
 * or a comment is ever taken for a section, a table, a link or a probe.
 */

import type { Citation, DocumentReader, SectionTables, UnreadableFrontMatterLine } from './document.js';
import type { CodeBlock } from './probe.js';
import type { TableView } from './rulings.js';
import { findEntry, readFrontMatter, scanMarkdown, type FrontMatter, type MarkdownScan } from './vendor/spec-core/markdown/index.js';
import { splitLines } from './vendor/spec-core/text/index.js';

/** Section names compare without case, emphasis, a leading number or a trailing colon. */
export function sameSection(heading: string, name: string): boolean {
  // Both names are folded the same way and then compared, so the mutant that
  // folds them to upper case is equivalent.
  const normal = (text: string): string =>
    text
      .replace(/[*_`]/g, '')
      .replace(/^\s*\d+[.)]?\s+/, '')
      .replace(/[:\s]+$/, '')
      .trim()
      .toLowerCase();
  return normal(heading) === normal(name);
}

/**
 * The lines of closed YAML front matter spec-core's reader passes over, since
 * none is `key: value`, each with its reason. The reader reports a problem on
 * a line it read too - a key declared twice - and one on the opening line for
 * TOML front matter; neither is a line passed over, and only these are. A
 * byte-order mark, which the reader leaves out, sits on the opening line,
 * never one of these, so the text's own lines give each as written.
 */
function unreadLines(text: string, front: FrontMatter | null): UnreadableFrontMatterLine[] {
  if (front === null) return [];
  const read = new Set(front.entries.map((entry) => entry.line));
  const lines = splitLines(text);
  return front.problems
    .filter((problem) => problem.line > 0 && !read.has(problem.line))
    .map((problem) => ({ line: problem.line + 1, text: lines[problem.line] as string, reason: problem.message }));
}

function scanOf(text: string, cache: { text: string; scan: MarkdownScan } | null): MarkdownScan {
  return cache !== null && cache.text === text ? cache.scan : scanMarkdown(text);
}

export function createReader(): DocumentReader {
  // Commands read the same brief several times in a row; one scan serves them.
  // It spares a scan and changes no answer, so the mutant that keeps nothing
  // is equivalent.
  let last: { text: string; scan: MarkdownScan } | null = null;
  const scan = (text: string): MarkdownScan => {
    const result = scanOf(text, last);
    last = { text, scan: result };
    return result;
  };

  return {
    codeBlocks(text: string): CodeBlock[] {
      const scanned = scan(text);
      const spaces = (line: string): number => (/^ */.exec(line) as RegExpExecArray)[0].length;
      return scanned.blocks
        .filter((block) => block.kind === 'fenced')
        .map((block) => {
          const first = block.line + 1;
          const last = block.closed ? block.endLine - 1 : block.endLine;
          // A fence in a block quote or a list item: its content is the code
          // without the quote markers and without the fence's own indent, as
          // CommonMark reads it, so a probe file is written as it was meant.
          const indent = spaces(scanned.lines[block.line - 1]?.content ?? '');
          const lines: string[] = [];
          for (let line = first; line <= last; line += 1) {
            const content = scanned.lines[line - 1]?.content ?? '';
            lines.push(content.slice(Math.min(indent, spaces(content))));
          }
          return { info: block.info, content: lines.join('\n'), line: block.line };
        });
    },

    sectionAt(text: string, line: number): string | null {
      let found: string | null = null;
      for (const heading of scan(text).headings) {
        if (heading.line > line) break;
        if (heading.level >= 2) found = heading.text;
      }
      return found;
    },

    sectionsAt(text: string, line: number): string[] {
      const open: { level: number; text: string }[] = [];
      for (const heading of scan(text).headings) {
        if (heading.line > line) break;
        if (heading.level < 2) continue;
        while (open.length > 0 && (open[open.length - 1] as { level: number }).level >= heading.level) open.pop();
        open.push({ level: heading.level, text: heading.text });
      }
      return open.map((section) => section.text);
    },

    sectionTables(text: string, section: string): SectionTables {
      const scanned = scan(text);
      const headings = scanned.headings;
      const index = headings.findIndex((heading) => heading.level >= 2 && sameSection(heading.text, section));
      if (index < 0) return { tables: [], headingLine: null, tableEndLine: null };
      const heading = headings[index] as (typeof headings)[number];
      const next = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
      const endLine = next === undefined ? scanned.index.lineCount + 1 : next.line;
      const tables = scanned.tables.filter((table) => table.line > heading.endLine && table.line < endLine);
      const views: TableView[] = tables.map((table) => ({
        headers: table.headers.map((cell) => cell.text),
        rows: table.rows.map((row) => ({ cells: row.cells.map((cell) => cell.text), line: row.line })),
      }));
      const lastTable = tables[tables.length - 1];
      return { tables: views, headingLine: heading.endLine, tableEndLine: lastTable === undefined ? null : lastTable.endLine };
    },

    citations(text: string): Citation[] {
      return scan(text)
        .links.filter((link) => !link.image && link.form !== 'autolink' && link.form !== 'definition')
        .map((link) => ({ target: link.target, line: link.line }));
    },

    titleAndStatus(text: string): {
      title: string | null;
      status: string | null;
      unclosedFrontMatter: boolean;
      unreadableFrontMatter: UnreadableFrontMatterLine[];
    } {
      const scanned = scan(text);
      const title = scanned.headings.find((heading) => heading.level === 1)?.text ?? null;
      const front = readFrontMatter(text);
      let status: string | null = null;
      // The status is read under `status` alone: a key in another language,
      // such as `狀態`, is another key (ADR-0001).
      const entry = findEntry(front, 'status');
      if (entry !== undefined && entry.value.kind === 'scalar') status = entry.value.scalar.text || null;
      // TOML front matter gives no status, closed or not, so closing it would
      // change nothing the context packet shows; only YAML's is worth saying.
      return {
        title,
        status,
        unclosedFrontMatter: scanned.unclosedFrontMatter?.kind === 'yaml',
        unreadableFrontMatter: unreadLines(text, front),
      };
    },
  };
}
