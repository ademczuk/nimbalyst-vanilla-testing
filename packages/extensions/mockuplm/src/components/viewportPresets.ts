/**
 * Responsive viewport presets shared by the viewport selector and by comment
 * placement, which records the preset a pin was placed at so a free pin can
 * say "placed at Desktop 1440" instead of silently drifting.
 */

export interface ViewportPreset {
  label: string;
  /** null = full width (responsive). */
  width: number | null;
  icon: string;
}

export const VIEWPORT_PRESETS: ViewportPreset[] = [
  { label: "Full", width: null, icon: "monitor" },
  { label: "Desktop", width: 1440, icon: "desktop" },
  { label: "Laptop", width: 1024, icon: "laptop" },
  { label: "Tablet", width: 768, icon: "tablet" },
  { label: "Mobile", width: 375, icon: "mobile" },
];

/**
 * Name the preset a measured width belongs to. The mockup editor renders at
 * whatever width the pane happens to be, so this reports the nearest preset
 * band rather than requiring an explicit preset selection.
 */
export function describeViewportWidth(width: number): string {
  if (!Number.isFinite(width) || width <= 0) return "Unknown";
  const bands = VIEWPORT_PRESETS.filter(
    (preset): preset is ViewportPreset & { width: number } => preset.width !== null
  ).sort((a, b) => a.width - b.width);

  for (const band of bands) {
    if (width <= band.width) return band.label;
  }
  return bands[bands.length - 1]?.label ?? "Desktop";
}
