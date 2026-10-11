// Types for the tests that import scripts/mutation-unmeasured.mjs. A report's
// files are typed only as far as the count reads them.

export interface Sources {
  [name: string]: {
    source: string;
    mutants?: { location: { start: { line: number; column: number }; end: { line: number; column: number } }; [field: string]: unknown }[] | undefined;
    [field: string]: unknown;
  };
}

export interface Measured {
  files: number;
  mutants: number;
  /** The outermost `as` expressions, with or without a place under them. */
  expressions: number;
  sites: number;
  mutantsInside: number;
  /** Each `as` with a place under it, the most places first. */
  rows: { file: string; line: number; sites: number; text: string }[];
}

export type Parse = (source: string) => unknown;

export declare const LEFT: number;
export declare class UnmeasuredError extends Error {}
export declare function babel(): Promise<Parse>;
export declare function measure(files: Sources, parse: Parse): Measured;
export declare function verdict(measured: Measured, left?: number): { passed: boolean; message: string };
export declare function sourcesOnDisk(root: string): Promise<Sources>;
export declare function render(measured: Measured, what: string): string;
