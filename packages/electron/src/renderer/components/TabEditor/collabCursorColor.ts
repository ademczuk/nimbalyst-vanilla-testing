/**
 * Stable per-identity cursor/presence color.
 *
 * Its own module so presence-producing code that is not the collab editor host
 * (headless agent writes, for one) colors participants from the same palette
 * rather than inventing a second one.
 */
const CURSOR_COLORS = [
  '#E05555', '#2BA89A', '#3A8FD6', '#D97706',
  '#9B59B6', '#E06B8F', '#3B82F6', '#16A34A',
];

export function pickCursorColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return CURSOR_COLORS[Math.abs(h) % CURSOR_COLORS.length];
}
