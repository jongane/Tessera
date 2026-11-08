import { readFileSync } from 'node:fs';
import type { ActivityDetails as SharedDetails } from '@tessera/shared';
import { describe, expect, it } from 'vitest';
import type { ActivityDetails as ApiDetails } from './activity.js';

// Web PR 7d (agreed 2026-11-08): the API takes ActivityDetails from
// @tessera/shared, type-only, so the API and the web app cannot disagree
// about the shape of a history line.

// Compile-level: the API's type and the shared one assign to each other
// both ways. Checked by `tsc` and the type-aware linter; vitest itself does
// not type-check.
const toShared: SharedDetails = {} as ApiDetails;
const toApi: ApiDetails = {} as SharedDetails;

describe('ActivityDetails in the API', () => {
  it('has the same shape as the shared one, both ways', () => {
    expect([toShared, toApi]).toHaveLength(2);
  });

  it('is imported from @tessera/shared with a type-only import, not declared again', () => {
    const source = readFileSync(
      new URL('./activity.ts', import.meta.url),
      'utf8',
    );

    expect(source).not.toMatch(/(interface|type)\s+ActivityDetails\b/);
    expect(source).toMatch(
      /import type \{[^}]*\bActivityDetails\b[^}]*\} from '@tessera\/shared'/,
    );
  });
});
