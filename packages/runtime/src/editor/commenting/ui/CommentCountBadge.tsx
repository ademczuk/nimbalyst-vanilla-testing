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

export function CommentCountBadge({
  count,
  max = 99,
  label,
  className,
}: CommentCountBadgeProps): JSX.Element | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return (
    <span
      className={
        className
          ? `nim-comment-count-badge ${className}`
          : 'nim-comment-count-badge'
      }
      data-testid="comment-count-badge"
      aria-label={
        label ?? `${count} comment ${count === 1 ? 'thread' : 'threads'}`
      }
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}
