// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendSyncClientParams,
  getSyncClientInfo,
  redactSyncUrl,
  setSyncClientInfo,
} from '../syncClientInfo';

const DEFAULTS = { platform: 'unknown', version: 'unknown' };

afterEach(() => {
  // Reset the module-level singleton so tests don't leak state.
  setSyncClientInfo(DEFAULTS);
});

describe('appendSyncClientParams', () => {
  it('appends platform and version after an existing token query', () => {
    setSyncClientInfo({ platform: 'desktop', version: '1.4.2' });
    const url = appendSyncClientParams('wss://sync.nimbalyst.com/sync/room?token=jwt');
    expect(url).toBe(
      'wss://sync.nimbalyst.com/sync/room?token=jwt&platform=desktop&version=1.4.2'
    );
  });

  it('URL-encodes the label values', () => {
    setSyncClientInfo({ platform: 'web', version: '1.0.0 beta/2' });
    const url = appendSyncClientParams('wss://host/sync/r?token=t');
    expect(url).toBe('wss://host/sync/r?token=t&platform=web&version=1.0.0%20beta%2F2');
  });

  it('clamps each label to 32 chars before encoding', () => {
    const longVersion = 'v'.repeat(40);
    setSyncClientInfo({ platform: 'mobile', version: longVersion });
    const url = appendSyncClientParams('wss://host/sync/r?token=t');
    expect(url).toBe(`wss://host/sync/r?token=t&platform=mobile&version=${'v'.repeat(32)}`);
  });

  it('does not attribute an uninitialized cross-platform client to desktop', async () => {
    vi.resetModules();
    const freshClientInfo = await import('../syncClientInfo');
    expect(freshClientInfo.getSyncClientInfo()).toEqual(DEFAULTS);
    const url = freshClientInfo.appendSyncClientParams('wss://host/sync/r?token=t');
    expect(url).toBe('wss://host/sync/r?token=t&platform=unknown&version=unknown');
  });
});

describe('redactSyncUrl', () => {
  // A real socket URL: JWT first, telemetry labels appended after it. The JWT
  // is a live credential for days, and main.log is a file we ask users to read.
  const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJtZW1iZXItbGl2ZSJ9.c2lnbmF0dXJl';
  const REAL_URL =
    `wss://sync.nimbalyst.com/sync/org:o1:user:u1:session:s1?token=${JWT}&platform=desktop&version=0.76.0`;

  it('strips the token while preserving the rest of the URL', () => {
    expect(redactSyncUrl(REAL_URL)).toBe(
      'wss://sync.nimbalyst.com/sync/org:o1:user:u1:session:s1?token=<redacted>&platform=desktop&version=0.76.0'
    );
  });

  it('leaves no fragment of the token behind', () => {
    const redacted = redactSyncUrl(REAL_URL);
    // Guard against a partial match that trims the signature but leaks the
    // header/payload -- those alone carry org id, member id and expiry.
    for (const segment of JWT.split('.')) {
      expect(redacted).not.toContain(segment);
    }
  });

  it('redacts a token that appears first in the query string', () => {
    expect(redactSyncUrl('wss://host/sync/r?token=abc123')).toBe(
      'wss://host/sync/r?token=<redacted>'
    );
  });

  it('does not mangle a param that merely ends in "token"', () => {
    // `[?&]token=` must anchor, or refresh_token= would be partially rewritten.
    expect(redactSyncUrl('wss://host/sync/r?refresh_token=keepme&token=secret')).toBe(
      'wss://host/sync/r?refresh_token=keepme&token=<redacted>'
    );
  });

  it('returns undefined for a missing URL so callers can log it directly', () => {
    // WebSocket error events can carry an undefined target url.
    expect(redactSyncUrl(undefined)).toBeUndefined();
  });
});
