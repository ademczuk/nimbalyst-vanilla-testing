/**
 * The tinted pill that names a type, a tag, or a priority.
 *
 * The board card alone carried three hand-rolled copies of the same
 * `color` + `${color}20` background arithmetic, at three slightly different font
 * sizes for no reason anyone recorded. Two sizes are enough: the value's own
 * badge, and the secondary tags that sit beside it.
 *
 * The hue is handed to CSS as `--tracker-swatch` and every derived color is
 * resolved from it against the canonical theme variables -- see
 * `trackerSwatch.css` for why that is not done here in JS.
 */
import React from 'react';
import './trackerSwatch.css';
export interface TrackerSwatchBadgeProps {
    label: string;
    /** Hex swatch from the schema; the fill, border and text are derived from it. */
    color: string;
    /** `secondary` is smaller and outlined, for the trailing type tags. */
    variant?: 'primary' | 'secondary';
    className?: string;
    title?: string;
}
export declare function TrackerSwatchBadge({ label, color, variant, className, title, }: TrackerSwatchBadgeProps): React.JSX.Element;
