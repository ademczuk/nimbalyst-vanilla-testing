// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { claimSignInAttribution, resetSignInAttributionClaims } from '../SignInAttribution';

describe('claimSignInAttribution', () => {
  beforeEach(resetSignInAttributionClaims);

  // The auth broadcast reaches every project window at once; exactly one of
  // them may record the sign-in, and which one must not depend on focus.
  it('grants one window the sign-in and refuses the rest', () => {
    expect(claimSignInAttribution('user-1', 1_000)).toBe(true);
    expect(claimSignInAttribution('user-1', 1_010)).toBe(false);
    expect(claimSignInAttribution('user-1', 1_400)).toBe(false);
  });

  it('records a genuinely later sign-in rather than swallowing it forever', () => {
    expect(claimSignInAttribution('user-1', 1_000)).toBe(true);
    expect(claimSignInAttribution('user-1', 1_000 + 6 * 60_000)).toBe(true);
  });

  it('keeps separate accounts separate', () => {
    expect(claimSignInAttribution('user-1', 1_000)).toBe(true);
    expect(claimSignInAttribution('user-2', 1_000)).toBe(true);
  });
});
