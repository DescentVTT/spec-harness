// Types for the tests that import scripts/mutation-compare.mjs. A report is
// typed only as far as the comparison reads it.

export interface Position {
  line: number;
  column: number;
}

export interface Location {
  start: Position;
  end: Position;
}

export interface Compared {
  files: Record<
    string,
    {
      source?: string | undefined;
      mutants?: { mutatorName: string; replacement?: string | undefined; status: string; location: Location; [field: string]: unknown }[] | undefined;
      [field: string]: unknown;
    }
  >;
  [field: string]: unknown;
}

/** A mutant by what makes it the same in another report, with each line it stands on in this one. */
export interface Row {
  file: string;
  mutator: string;
  text: string;
  replacement: string;
  at: { line: number; status: string }[];
}

/** A row one report has more of than the other, and by how many. */
export interface Differing extends Row {
  count: number;
}

export interface Counts {
  mutants: number;
  survived: number;
  noCoverage: number;
  undetected: number;
}

export interface Comparison {
  here: Counts;
  main: Counts;
  fresh: Differing[];
  gone: Differing[];
  new: number;
  lost: number;
}

export type Gh = (args: string[]) => string;

export type Fetched = { file: string; run: string; sha: string; created: string; url: string; reason?: undefined } | { reason: string };

export declare class CompareError extends Error {}
export declare function mutatedText(source: string, location: Location): string;
export declare function undetected(report: unknown, name: string): Counts & { found: Map<string, Row> };
export declare function compare(mains: unknown, here: unknown): Comparison;
export declare function line(row: Differing): string;
export declare function render(result: Comparison, against: string): string;
export declare function summary(result: Comparison, against: string): string;
export declare function notCompared(reason: string): string;
export declare function mainsReport(options: { gh: Gh; repository: string; directory: string; own: string }): Fetched;
export declare function main(
  argv: readonly string[],
  options?: { env?: Readonly<Record<string, string | undefined>>; gh?: Gh; directory?: string; log?: (text: string) => void; fail?: (text: string) => void },
): number;
