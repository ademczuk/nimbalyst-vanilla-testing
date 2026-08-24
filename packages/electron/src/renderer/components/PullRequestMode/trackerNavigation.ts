/** Route the window to a tracker item; App.tsx owns the listener. */
export function navigateToTrackerItem(itemId: string): void {
  window.dispatchEvent(
    new CustomEvent('nimbalyst:navigate-tracker-item', { detail: { itemId } }),
  );
}
