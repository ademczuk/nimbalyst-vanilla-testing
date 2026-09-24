/**
 * The state menu for surfaces outside the embedded box (a page's own state
 * line). Exported from the barrels in place of the menu itself so the tracker
 * surfaces' eager bundle does not carry it: the plain state word renders at
 * once, and the menu replaces it when its chunk arrives.
 */

import { lazy, Suspense } from 'react';
import type { JSX } from 'react';

import { stateTone } from './trackerReferenceLifecycle';
import type { TrackerStateMenuProps } from './TrackerStateMenu';

const Menu = lazy(() => import('./TrackerStateMenu').then((module) => ({ default: module.TrackerStateMenu })));

export function TrackerStateMenu(props: TrackerStateMenuProps): JSX.Element | null {
  const status = props.resolver.statusInfo(props.item);
  if (!status) return null;
  const word = (
    <span className="tracker-state-word" data-tone={stateTone(props.item.type, status)} data-status={status.value}>
      {status.label}
    </span>
  );
  return <Suspense fallback={word}><Menu {...props} /></Suspense>;
}
