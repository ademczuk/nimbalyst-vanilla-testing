// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseExtensionInstallLink } from '../extensionInstallDeepLink';

describe('parseExtensionInstallLink', () => {
  it('extracts the extension id from a well-formed install link', () => {
    expect(parseExtensionInstallLink('nimbalyst://install/com.nimbalyst.jupyter')).toBe(
      'com.nimbalyst.jupyter',
    );
  });

  it('ignores links that are not install links', () => {
    expect(parseExtensionInstallLink('nimbalyst://conversation/abc')).toBeNull();
    expect(parseExtensionInstallLink('https://example.test/install/x')).toBeNull();
    expect(parseExtensionInstallLink('#heading')).toBeNull();
    expect(parseExtensionInstallLink(null)).toBeNull();
    expect(parseExtensionInstallLink(undefined)).toBeNull();
  });

  it('returns null for an install link with no id', () => {
    // Would otherwise open the marketplace on nothing.
    expect(parseExtensionInstallLink('nimbalyst://install/')).toBeNull();
    expect(parseExtensionInstallLink('nimbalyst://install/   ')).toBeNull();
  });

  it('drops a trailing query or fragment', () => {
    expect(parseExtensionInstallLink('nimbalyst://install/com.nimbalyst.git?ref=coach')).toBe(
      'com.nimbalyst.git',
    );
    expect(parseExtensionInstallLink('nimbalyst://install/com.nimbalyst.git#top')).toBe(
      'com.nimbalyst.git',
    );
  });

  it('decodes a percent-encoded id', () => {
    expect(parseExtensionInstallLink('nimbalyst://install/com.example.my%20ext')).toBe(
      'com.example.my ext',
    );
  });

  it('returns null instead of throwing on a malformed escape', () => {
    // decodeURIComponent raises URIError here. This runs inside a document-level
    // click listener, so an uncaught throw would surface far from the link.
    expect(() => parseExtensionInstallLink('nimbalyst://install/%ZZ')).not.toThrow();
    expect(parseExtensionInstallLink('nimbalyst://install/%ZZ')).toBeNull();
  });
});
