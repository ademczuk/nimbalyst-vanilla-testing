export function reportResolvedTitleBarColors(
  root: HTMLElement = document.documentElement,
): void {
  const styles = getComputedStyle(root);
  const color = styles.getPropertyValue('--nim-bg-secondary').trim();
  const symbolColor = styles.getPropertyValue('--nim-text').trim();
  if (!color || !symbolColor) return;

  // --nim-bg rides along so main can persist the theme's real canvas colour
  // and paint it at window creation on the next launch, before CSS parses.
  const backgroundColor = styles.getPropertyValue('--nim-bg').trim() || undefined;

  window.electronAPI?.setTitleBarOverlayColors?.({ color, symbolColor, backgroundColor });
}
