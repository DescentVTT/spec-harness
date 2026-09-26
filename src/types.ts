/** Types shared across modules. Type-only: compiles to nothing. */

export type Severity = 'error' | 'warning' | 'note';

/** One thing a command found, where to fix it, and what to do next (spec-core ADR-0005). */
export interface Finding {
  readonly rule: string;
  readonly severity: Severity;
  readonly message: string;
  readonly hint: string;
  readonly file?: string | undefined;
  readonly line?: number | undefined;
}

/** A brief as `spec-brief list --format json` reports it. */
export interface BriefRow {
  readonly id: string;
  /** Repository-relative POSIX path. */
  readonly file: string;
  readonly title: string | null;
  readonly phase: 'live' | 'archived';
  readonly status: string | null;
  readonly type: string | null;
  readonly wave: number | null;
  readonly dependsOn: readonly string[];
  readonly affectedFiles: readonly string[];
  readonly protectedFiles: readonly string[];
  readonly tasks: { readonly total: number; readonly checked: number };
  readonly ready: boolean;
  readonly waitingOn: readonly string[];
}

/** A file a range of commits changed, as `git diff --name-status` reports it. */
export interface FileChange {
  readonly status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T';
  readonly path: string;
  /** The path it came from, for a rename or a copy. */
  readonly from?: string | undefined;
}
