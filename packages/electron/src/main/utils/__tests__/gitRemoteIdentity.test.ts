// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { legacyNormalizeGitRemote, normalizeGitRemote } from '../gitUtils';

/**
 * The identifier hashed for the team lookup. Two clones of one repository must
 * agree whatever each teammate's `origin` looks like -- that equality is the
 * whole point, and the bug it replaces made a credentialed origin and a clean
 * clone hash differently, so the inviter's teammates never matched the project.
 */
describe('normalizeGitRemote', () => {
  it.each([
    ['https://user:ghp_secret@github.com/acme/widgets.git', 'github.com/acme/widgets'],
    ['https://user@github.com/acme/widgets.git', 'github.com/acme/widgets'],
    ['ssh://git:pw@github.com/acme/widgets.git', 'github.com/acme/widgets'],
    ['ssh://git@github.com/acme/widgets.git', 'github.com/acme/widgets'],
    ['https://github.com/acme/widgets.git', 'github.com/acme/widgets'],
    ['git@github.com:acme/widgets.git', 'github.com/acme/widgets'],
    ['https://GitHub.com/Acme/Widgets.git/', 'github.com/acme/widgets'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeGitRemote(raw)).toBe(expected);
  });

  it('keeps a non-default ssh port, which addresses a different remote', () => {
    expect(normalizeGitRemote('ssh://git@github.com:2222/acme/widgets.git'))
      .toBe('github.com:2222/acme/widgets');
  });

  it('gives a credentialed origin and a clean clone of it the same identity', () => {
    expect(normalizeGitRemote('https://user:ghp_secret@github.com/acme/widgets.git'))
      .toBe(normalizeGitRemote('https://github.com/acme/widgets.git'));
  });
});

/**
 * Retained because its output is a persisted key. Pinned here so a future
 * session cannot "simplify" the two functions back into one: `ssh://git@` is a
 * credential-free remote whose legacy identifier carries `git@`, so re-keying
 * it would unbind every workspace on a non-default-port SSH remote.
 */
describe('legacyNormalizeGitRemote', () => {
  it.each([
    ['ssh://git@github.com/acme/widgets.git', 'ssh///git@github.com/acme/widgets'],
    ['https://user:ghp_secret@github.com/acme/widgets.git', 'user/ghp_secret@github.com/acme/widgets'],
    ['https://github.com/acme/widgets.git', 'github.com/acme/widgets'],
    ['git@github.com:acme/widgets.git', 'github.com/acme/widgets'],
  ])('%s -> %s', (raw, expected) => {
    expect(legacyNormalizeGitRemote(raw)).toBe(expected);
  });

  it('differs from the canonical form exactly where a stored hash is at stake', () => {
    const credentialFreeSsh = 'ssh://git@github.com/acme/widgets.git';
    expect(legacyNormalizeGitRemote(credentialFreeSsh))
      .not.toBe(normalizeGitRemote(credentialFreeSsh));
  });
});
