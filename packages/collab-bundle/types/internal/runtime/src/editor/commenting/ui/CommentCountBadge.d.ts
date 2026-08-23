/**
 * Thread/comment count pill.
 *
 * Renders nothing at zero so a quiet document carries no ornament, and caps
 * the printed value so a very busy document cannot stretch the control it
 * sits on.
 */
import type { JSX } from 'react';
export interface CommentCountBadgeProps {
    count: number;
    /** Printed as `${max}+` beyond this. */
    max?: number;
    /** Accessible name; defaults to "N comment threads". */
    label?: string;
    className?: string;
}
export declare function CommentCountBadge({ count, max, label, className, }: CommentCountBadgeProps): JSX.Element | null;
