/**
 * SearchReplaceStateManager
 *
 * Manages per-tab search/replace state for the find/replace bar.
 * Each tab instance has isolated state (even for the same file path).
 */

export interface SearchReplaceState {
  isOpen: boolean;
  /**
   * Bumped every time the Find command is issued. The bar focuses its input on
   * a change to this, not on `isOpen`, so a second Find on an already-open bar
   * still pulls focus back out of the document (#1388).
   */
  focusNonce: number;
  searchString: string;
  replaceString: string;
  caseInsensitive: boolean;
  useRegex: boolean;
  matches: Array<{ start: number; end: number }>;
  currentMatchIndex: number;
}

type StateChangeListener = (tabId: string, state: SearchReplaceState) => void;

class SearchReplaceStateManagerClass {
  private states: Map<string, SearchReplaceState> = new Map();
  private listeners: Set<StateChangeListener> = new Set();

  /**
   * Get the default state for a new tab
   */
  private getDefaultState(): SearchReplaceState {
    return {
      isOpen: false,
      focusNonce: 0,
      searchString: '',
      replaceString: '',
      caseInsensitive: true,
      useRegex: false,
      matches: [],
      currentMatchIndex: -1,
    };
  }

  /**
   * Get state for a tab (creates default state if doesn't exist)
   */
  getState(tabId: string): SearchReplaceState {
    if (!tabId) {
      throw new Error('tabId is required');
    }

    if (!this.states.has(tabId)) {
      this.states.set(tabId, this.getDefaultState());
    }
    return this.states.get(tabId)!;
  }

  /**
   * Update state for a tab
   */
  updateState(tabId: string, updates: Partial<SearchReplaceState>): void {
    if (!tabId) {
      throw new Error('tabId is required');
    }

    const currentState = this.getState(tabId);
    const newState = { ...currentState, ...updates };
    this.states.set(tabId, newState);
    this.notifyListeners(tabId, newState);
  }

  /**
   * Open the search/replace bar for a tab
   */
  open(tabId: string): void {
    if (!tabId) {
      throw new Error('tabId is required');
    }

    this.updateState(tabId, { isOpen: true });
  }

  /**
   * Close the search/replace bar for a tab
   */
  close(tabId: string): void {
    if (!tabId) {
      throw new Error('tabId is required');
    }

    this.updateState(tabId, { isOpen: false });
  }

  /**
   * Handle the Find command (Cmd+F) for a tab.
   *
   * Find is not a toggle. Every editor the user has ever used opens the bar on
   * the first Find and refocuses the already-open field on the next one -- it
   * never closes the bar and never hands focus back to the document, because
   * doing so turns the following keystrokes into unintended edits (#1388).
   * Escape is what closes the bar.
   */
  openAndFocus(tabId: string): void {
    if (!tabId) {
      throw new Error('tabId is required');
    }

    const currentState = this.getState(tabId);
    this.updateState(tabId, { isOpen: true, focusNonce: currentState.focusNonce + 1 });
  }

  /**
   * Check if the search/replace bar is open for a tab
   */
  isOpen(tabId: string): boolean {
    if (!tabId) {
      return false;
    }

    return this.getState(tabId).isOpen;
  }

  /**
   * Clear state for a tab (when tab is closed)
   */
  clearState(tabId: string): void {
    if (!tabId) {
      return;
    }

    this.states.delete(tabId);
  }

  /**
   * Add a listener for state changes
   */
  addListener(listener: StateChangeListener): void {
    this.listeners.add(listener);
  }

  /**
   * Remove a listener
   */
  removeListener(listener: StateChangeListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Notify all listeners of a state change
   */
  private notifyListeners(tabId: string, state: SearchReplaceState): void {
    this.listeners.forEach((listener) => {
      try {
        listener(tabId, state);
      } catch (error) {
        console.error('Error in SearchReplaceStateManager listener:', error);
      }
    });
  }

  /**
   * Get all tab IDs with open search bars (for debugging)
   */
  getOpenTabs(): string[] {
    const openTabs: string[] = [];
    this.states.forEach((state, tabId) => {
      if (state.isOpen) {
        openTabs.push(tabId);
      }
    });
    return openTabs;
  }
}

// Singleton instance
export const SearchReplaceStateManager = new SearchReplaceStateManagerClass();
