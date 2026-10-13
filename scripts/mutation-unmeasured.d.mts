// Types for the tests that import scripts/mutation-unmeasured.mjs. A report's
// files are typed only as far as the count reads them.

/** Where a mutant of a report stands: lines and columns from 1, the end the first character after. */
export interface Placed {
  location: { start: { line: number; column: number }; end: { line: number; column: number } };
}

export interface Sources {
  [name: string]: {
    source: string;
    mutants?: readonly Placed[] | undefined;
    [field: string]: unknown;
  };
}

/** An outermost `as` or enum with a place under it, and where it stands, as a report would say it. */
export interface Row {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  sites: number;
  text: string;
}

export interface Measured {
  files: number;
  mutants: number;
  /** The outermost `as` expressions and enums, with or without a place under them. */
  expressions: number;
  sites: number;
  mutantsInside: number;
  /** Each with a place under it, the most places first. */
  rows: Row[];
}

export type Parse = (source: string) => unknown;

export declare const LEFT: number;
export declare class UnmeasuredError extends Error {}
export declare function babel(from?: string): Promise<Parse>;
export declare function inside(row: Pick<Row, 'line' | 'column' | 'endLine' | 'endColumn'>, mutant: Placed): boolean;
export declare function measure(files: Sources, parse: Parse): Measured;
export declare function verdict(measured: Measured, left?: number): { passed: boolean; message: string };
export declare function sourcesOnDisk(root: string): Promise<Sources>;
export declare function render(measured: Measured, what: string): string;
