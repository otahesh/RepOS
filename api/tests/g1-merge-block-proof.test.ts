import { describe, it, expect } from 'vitest';

// G1 merge-block proof — DELIBERATELY FAILING. DO NOT MERGE.
//
// This file exists only to prove that branch protection on `main` blocks a PR
// with a red required check from merging. It trips the `api-unit` required
// status check on purpose. The PR carrying it is closed (and this branch
// deleted) immediately after confirming GitHub reports the PR as merge-blocked.
// If you are reading this on `main`, something went very wrong — revert it.
describe('G1 deliberate-break merge-block proof', () => {
  it('fails on purpose so the api-unit required check goes red', () => {
    expect(1).toBe(2);
  });
});
