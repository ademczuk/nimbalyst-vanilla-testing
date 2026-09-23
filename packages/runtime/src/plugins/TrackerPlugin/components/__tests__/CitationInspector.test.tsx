import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { CitationInspector, type CitationInspectorHost } from '../CitationInspector';

/**
 * The inspector's two rules, both of which are about what it must NOT do
 * quietly (knowledge-scopes contracts 4.2 and 4.4):
 *
 * - a malformed locator renders AS malformed, because "no locator" and "broken
 *   locator" are different problems and look identical if one is hidden;
 * - a pinned revision that cannot be read renders as a failure and never falls
 *   back to the item as it is now.
 *
 * Everything else here is layout and is deliberately not asserted on.
 */

const REVISION_UUID = '9f2c1d4a-7b31-4e59-a0c8-5d6e2f1b3a77';

function host(overrides: Partial<CitationInspectorHost> & {
  items?: Record<string, Record<string, unknown>>;
} = {}): CitationInspectorHost {
  const items = overrides.items ?? {};
  return {
    lookupItem: overrides.lookupItem ?? ((itemId) => items[itemId]
      ? { itemId, title: String(items[itemId].title ?? itemId), fields: items[itemId] }
      : null),
    ...(overrides.readRevision ? { readRevision: overrides.readRevision } : {}),
  };
}

describe('CitationInspector', () => {
  it('shows an invalid locator with its stable error code rather than omitting it', () => {
    render(
      <CitationInspector
        entry={{ itemId: 'cit_1' }}
        host={host({
          items: {
            cit_1: {
              title: 'A citation',
              // `page: 0` is not a page. Silently dropping this row would read
              // as "this citation names a document, not a passage".
              locator: { selectorType: 'pdf-page', version: 1, page: 0 },
            },
          },
        })}
      />,
    );
    expect(screen.getByText('LOCATOR_INVALID_FIELD')).toBeTruthy();
    expect(screen.queryByText(/names a document, not a passage/)).toBeNull();
  });

  it('renders a valid locator property by property, not just as a summary', () => {
    render(
      <CitationInspector
        entry={{ itemId: 'cit_1' }}
        host={host({
          items: {
            cit_1: {
              title: 'A citation',
              locator: {
                selectorType: 'repo-lines',
                version: 1,
                repository: 'github.com/x/y',
                commit: 'abc12345',
                path: 'docs/a.md',
                startLine: 10,
                endLine: 14,
              },
            },
          },
        })}
      />,
    );
    expect(screen.getByText('docs/a.md:10-14 @ abc12345')).toBeTruthy();
    expect(screen.getByText('github.com/x/y')).toBeTruthy();
  });

  it('reports a failed revision read and shows nothing from the live item in its place', async () => {
    const readRevision = vi.fn().mockRejectedValue(
      new Error("Tracker item 'dec_1' has no revision 3"),
    );
    render(
      <CitationInspector
        entry={{ itemId: 'cit_1' }}
        host={host({
          readRevision,
          items: {
            cit_1: {
              title: 'A citation',
              claim: { itemId: 'dec_1', title: 'Current title', revisionId: REVISION_UUID },
            },
            // The live item exists and is newer. It must not be substituted.
            dec_1: { title: 'Current title' },
          },
        })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Tracker item 'dec_1' has no revision 3")).toBeTruthy();
    });
    expect(screen.queryByText('Revision')).toBeNull();
    expect(readRevision).toHaveBeenCalledWith('dec_1', { revisionId: REVISION_UUID });
  });

  it('says the host cannot answer when it keeps no revision log, which is not the same as unpinned', () => {
    render(
      <CitationInspector
        entry={{ itemId: 'cit_1' }}
        host={host({
          items: {
            cit_1: { title: 'A citation', claim: { itemId: 'dec_1', revisionId: REVISION_UUID } },
          },
        })}
      />,
    );
    expect(screen.getByText(/keeps no revision log/)).toBeTruthy();
    expect(screen.queryByText(/Not pinned/)).toBeNull();
  });

  it('renders the pinned revision as of that revision, not as of now', async () => {
    const readRevision = vi.fn().mockResolvedValue({
      revisionId: REVISION_UUID,
      serverRevision: 3,
      recordedAt: 1_700_000_000_000,
      data: { title: 'As it was' },
    });
    render(
      <CitationInspector
        entry={{ itemId: 'cit_1' }}
        host={host({
          readRevision,
          items: {
            cit_1: { title: 'A citation', claim: { itemId: 'dec_1', serverRevision: 3 } },
            dec_1: { title: 'Renamed since' },
          },
        })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('As it was')).toBeTruthy();
    });
    expect(screen.queryByText('Renamed since')).toBeNull();
    expect(readRevision).toHaveBeenCalledWith('dec_1', { serverRevision: 3 });
  });
});
