/**
 * The embedded box: "Decision · Proposed" on the first line, the title, the
 * substance (a decision's choice, a question's position, a rejection's why
 * not), and a muted meta line with who, when, and what needs doing.
 *
 * Two encodings only: the state word's color says what attention the item
 * needs, and the border says whether it is settled. The state word is the
 * control (see `TrackerStateMenu`); agent proposals resolve in place.
 */
import type { JSX } from 'react';
import { type ResolverProps } from './TrackerReferenceParts';
export declare function LiveCard({ resolver, referenceKey }: ResolverProps): JSX.Element;
