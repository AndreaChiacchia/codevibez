import { describe, expect, test } from 'claude-code/testing';

/**
 * The engine's specs were written for vitest's `it` and `it.each`; this maps
 * them onto Claude Code's own test kit, so `claude plugin test` runs them with
 * nothing installed.
 */
type Body = (...args: never[]) => unknown;

function each(rows: readonly unknown[]) {
  return (name: string, body: Body): void => {
    rows.forEach((row, index) => {
      const args = Array.isArray(row) ? row : [row];
      const title = name.replace('%s', String(args[0])).replace('%#', String(index));
      test(title, () => (body as (...values: unknown[]) => unknown)(...args));
    });
  };
}

export const it = Object.assign(
  (name: string, body: () => unknown): void => test(name, () => body()),
  { each },
);

export { describe, expect };
