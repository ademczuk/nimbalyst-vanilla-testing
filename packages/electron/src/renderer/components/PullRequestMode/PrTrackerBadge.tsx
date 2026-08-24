/**
 * PrTrackerBadge — the PR list's status badge: the shared, schema-driven
 * GitHub tracker badge under the `pr-tracker-badge` marker.
 *
 * The rendering itself lives in githubTrackerBadge.tsx so the issues list can
 * use the same badge with its own ladder and its own marker. The colour
 * helpers are re-exported here because the PR sidebar and strip already import
 * them from this module.
 */

import type { JSX } from 'react';
import { GithubTrackerBadge, type GithubTrackerBadgeProps } from './githubTrackerBadge';

export {
  FALLBACK_TRACKER_COLOR,
  trackerColorStyle,
  statusOptionFor,
  type TrackerStatusOption,
} from './githubTrackerBadge';

type PrTrackerBadgeProps = Omit<GithubTrackerBadgeProps, 'markerClass'>;

export function PrTrackerBadge(props: PrTrackerBadgeProps): JSX.Element | null {
  return <GithubTrackerBadge {...props} markerClass="pr-tracker-badge" />;
}
