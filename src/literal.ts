/**
 * A table with the types a const assertion gives it, where a mutation sweep
 * reads it.
 *
 * Stryker makes no mutant of anything that stands under a TypeScript `as`,
 * `as const` with the rest: it passes the whole expression over as a type.
 * The tables that decide what each command refuses were written
 * `{ ... } as const`, and no sweep had mutated a word of them (ADR-0010,
 * amended 2026-10-12). An argument is an expression like any other, and a
 * `const` type parameter reads it as the assertion did, each property
 * `readonly` and each value its own literal type.
 *
 * So a table whose literal types something reads is written
 * `literal({ ... })`, and never `{ ... } as const`.
 * `scripts/mutation-unmeasured.mjs` counts what stands under an `as`, and a
 * test holds the sources to its count.
 */
export function literal<const T>(value: T): T {
  return value;
}
