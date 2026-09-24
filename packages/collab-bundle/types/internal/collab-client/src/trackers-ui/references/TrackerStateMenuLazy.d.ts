/**
 * The state menu for surfaces outside the embedded box (a page's own state
 * line). Exported from the barrels in place of the menu itself so the tracker
 * surfaces' eager bundle does not carry it: the plain state word renders at
 * once, and the menu replaces it when its chunk arrives.
 */
import type { JSX } from 'react';
import type { TrackerStateMenuProps } from './TrackerStateMenu';
export declare function TrackerStateMenu(props: TrackerStateMenuProps): JSX.Element | null;
