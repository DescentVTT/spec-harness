/**
 * What the harness reads out of a brief or a cited document, through
 * spec-core's Markdown scanner so that code and comments are never mistaken
 * for structure: fenced blocks with their info strings, the section a line
 * sits in, a section's tables, the relative links a document cites, and a
 * document's title and status.
 */

import type { CodeBlock } from './probe.js';
import type { TableView } from './rulings.js';

export interface Citation {
  readonly target: string;
  /** 1-based. */
  readonly line: number;
}

export interface SectionTables {
  readonly tables: readonly TableView[];
  /** 1-based line of the section's heading, or `null` when there is no such section. */
  readonly headingLine: number | null;
  /** 0-based index of the line after the section's last table row, or `null` when it has no table. */
  readonly tableEndLine: number | null;
}

export interface DocumentReader {
  codeBlocks(text: string): CodeBlock[];
  sectionAt(text: string, line: number): string | null;
  /** Every section a line sits in, outermost first: a `###` under a `##` is in both. */
  sectionsAt(text: string, line: number): string[];
  sectionTables(text: string, section: string): SectionTables;
  citations(text: string): Citation[];
  /**
   * The first level-one heading, and the front matter's status. YAML front
   * matter opened on line 1 and never closed is `unclosedFrontMatter`: none
   * of it is read, so a status its author wrote there reads as none.
   */
  titleAndStatus(text: string): { readonly title: string | null; readonly status: string | null; readonly unclosedFrontMatter: boolean };
}
