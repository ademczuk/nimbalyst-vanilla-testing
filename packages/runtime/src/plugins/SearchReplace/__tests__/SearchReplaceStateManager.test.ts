// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { SearchReplaceStateManager } from '../SearchReplaceStateManager';

const TAB = '/tmp/notes.md';

describe('SearchReplaceStateManager.openAndFocus', () => {
  beforeEach(() => {
    SearchReplaceStateManager.clearState(TAB);
  });

  // The regression a reader cannot see: Find used to be a toggle, so the second
  // Cmd+F closed the bar and dropped focus back into the document, where the
  // user's next keystrokes silently edited the file (#1388).
  it('keeps the bar open and re-requests focus on a repeated Find', () => {
    SearchReplaceStateManager.openAndFocus(TAB);
    const first = SearchReplaceStateManager.getState(TAB);
    expect(first.isOpen).toBe(true);

    SearchReplaceStateManager.openAndFocus(TAB);
    const second = SearchReplaceStateManager.getState(TAB);
    expect(second.isOpen).toBe(true);
    expect(second.focusNonce).toBeGreaterThan(first.focusNonce);
  });

  it('reopens with a fresh focus request after the bar was closed', () => {
    SearchReplaceStateManager.openAndFocus(TAB);
    const opened = SearchReplaceStateManager.getState(TAB);

    SearchReplaceStateManager.close(TAB);
    expect(SearchReplaceStateManager.isOpen(TAB)).toBe(false);

    SearchReplaceStateManager.openAndFocus(TAB);
    const reopened = SearchReplaceStateManager.getState(TAB);
    expect(reopened.isOpen).toBe(true);
    expect(reopened.focusNonce).toBeGreaterThan(opened.focusNonce);
  });
});
