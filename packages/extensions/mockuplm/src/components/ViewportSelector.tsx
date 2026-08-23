/**
 * ViewportSelector - Responsive viewport preset buttons
 *
 * Allows users to preview mockups at different device widths.
 * The iframe width changes but the mockup source stays the same.
 */

import { memo } from 'react';
import { VIEWPORT_PRESETS } from './viewportPresets';

export type { ViewportPreset } from './viewportPresets';

interface ViewportSelectorProps {
  activeWidth: number | null;
  onSelect: (width: number | null) => void;
}

export const ViewportSelector = memo(function ViewportSelector({
  activeWidth,
  onSelect,
}: ViewportSelectorProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      {VIEWPORT_PRESETS.map((preset) => {
        const isActive = activeWidth === preset.width;
        return (
          <button
            key={preset.label}
            onClick={() => onSelect(preset.width)}
            title={preset.width ? `${preset.label} (${preset.width}px)` : 'Full width'}
            style={{
              padding: '3px 8px',
              fontSize: 11,
              fontWeight: isActive ? 600 : 400,
              background: isActive ? 'var(--nim-bg-active, #4a4a4a)' : 'transparent',
              color: isActive ? 'var(--nim-text, #e5e5e5)' : 'var(--nim-text-faint, #808080)',
              border: '1px solid',
              borderColor: isActive ? 'var(--nim-border, #4a4a4a)' : 'transparent',
              borderRadius: 4,
              cursor: 'pointer',
              whiteSpace: 'nowrap' as const,
            }}
          >
            {preset.label}
          </button>
        );
      })}
    </div>
  );
});
