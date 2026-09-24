/**
 * Live tracker reference views for hosts that resolve references through a
 * {@link TrackerReferenceResolver} rather than the desktop tracker atoms.
 *
 * Three presentations of one `TrackerReferenceNode`:
 *  - chip: inline key + title + status, the resting shape of every reference;
 *    or, where the host opts into the quiet inline appearance, the title as a
 *    tinted link with the rest in a hover peek.
 *  - card: a block summary of the item with the few fields its type is about.
 *  - statements: the claims whose subject is the item, grouped by predicate.
 *
 * With no resolver in context every view renders the store-free read-only chip,
 * so registering this renderer is safe in a host that never provides one.
 */

import type { JSX, ReactNode } from 'react';
import { useRef } from 'react';
import type { TrackerReferenceNodeRendererProps } from '@nimbalyst/runtime/plugins/TrackerLinkPlugin/TrackerReferenceNodeRenderer';
import {
  useTrackerReferenceEditorFocus,
  useTrackerReferenceNodeSelected,
} from '@nimbalyst/runtime/plugins/TrackerLinkPlugin/TrackerReferenceNodeRenderer';
import { TrackerReferenceReadOnlyChip } from '@nimbalyst/runtime/plugins/TrackerLinkPlugin/TrackerReferenceReadOnlyChip';

import type { TrackerItem } from '../../trackers/dataSource';
import { LiveCard } from './TrackerReferenceCard';
import { QuietLink, useTrackerReferenceInlineAppearance } from './TrackerReferenceQuietLink';
import { TrackerStateMenuFocusContext } from './TrackerStateMenu';
import {
  LiveChip,
  openHandlers,
  plural,
  StatementObject,
  StatusBadge,
  type ResolverProps,
} from './TrackerReferenceParts';
import {
  useTrackerReference,
  useTrackerReferenceResolver,
  useTrackerStatements,
} from './TrackerReferenceResolverContext';
import type { TrackerReferenceResolver } from './trackerReferenceResolver';
import './trackerReferenceViews.css';

/** Mirrors the runtime node's `TrackerReferenceView`; optional so a pre-view node renders as a chip. */
export type TrackerReferenceViewKind = 'chip' | 'card' | 'statements';

export type LiveTrackerReferenceRendererProps = TrackerReferenceNodeRendererProps & {
  view?: TrackerReferenceViewKind;
};

/** Live inline chip for an item id or key, for use inside cards and host surfaces. */
export function TrackerReferenceChipView({ referenceKey }: { referenceKey: string }): JSX.Element {
  const resolver = useTrackerReferenceResolver();
  if (!resolver) {
    // Asserted rather than annotated so this compiles whether or not the
    // runtime props carry `view` yet.
    const fallback = { referenceKey, nodeKey: '', view: 'chip' } as TrackerReferenceNodeRendererProps;
    return <TrackerReferenceReadOnlyChip {...fallback} />;
  }
  return <LiveChip resolver={resolver} referenceKey={referenceKey} />;
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

function StatementsFor({ resolver, item, referenceKey }: {
  resolver: TrackerReferenceResolver;
  item: TrackerItem;
  referenceKey: string;
}): JSX.Element {
  const groups = useTrackerStatements(resolver, item.id);
  return (
    <div className="tracker-reference-statements" data-issue-key={referenceKey} data-state="resolved">
      <div className="tracker-reference-statements-header">
        <span className="tracker-reference-statements-heading">Statements about</span>
        <LiveChip resolver={resolver} referenceKey={item.id} />
      </div>
      {groups.length === 0 ? (
        <div className="tracker-reference-statements-empty">No statements yet.</div>
      ) : (
        groups.map((group) => (
          <section className="tracker-reference-statements-group" key={group.predicateId ?? ''}>
            <div className="tracker-reference-statements-predicate">{group.label}</div>
            <ul className="tracker-reference-statements-list">
              {group.statements.map((statement) => (
                <li className="tracker-reference-statement-row" key={statement.claim.id} data-claim-id={statement.claim.id}>
                  <span
                    className="tracker-reference-statement-object"
                    title={statement.claim.title}
                    {...openHandlers(resolver, statement.objectItemId ? null : statement.claim.id)}
                  >
                    <StatementObject resolver={resolver} statement={statement} />
                    {!statement.objectItemId && !statement.valueText ? statement.claim.title : null}
                  </span>
                  <span className="tracker-reference-statement-meta">
                    {statement.basisLabel ? (
                      <span className="tracker-reference-statement-basis">{statement.basisLabel}</span>
                    ) : null}
                    {statement.citationCount > 0 ? (
                      <span className="tracker-reference-statement-citations" title={plural(statement.citationCount, 'citation')}>
                        <span className="material-symbols-outlined" aria-hidden="true">format_quote</span>
                        {statement.citationCount}
                      </span>
                    ) : null}
                    <StatusBadge status={statement.status} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function LiveStatements({ resolver, referenceKey }: ResolverProps): JSX.Element {
  const resolution = useTrackerReference(resolver, referenceKey);
  if (resolution.state !== 'resolved') {
    return (
      <div className="tracker-reference-statements" data-issue-key={referenceKey} data-state={resolution.state}>
        <div className="tracker-reference-statements-empty">
          {resolution.state === 'loading' ? `Loading ${referenceKey}...` : `${referenceKey} was not found`}
        </div>
      </div>
    );
  }
  return <StatementsFor resolver={resolver} item={resolution.item} referenceKey={referenceKey} />;
}

// ---------------------------------------------------------------------------
// Node renderer
// ---------------------------------------------------------------------------

/**
 * `TrackerReferenceNode` renderer for hosts with a resolver in context. Falls
 * back to the read-only chip, in every view, when none is provided.
 */
export function LiveTrackerReferenceRenderer(props: LiveTrackerReferenceRendererProps): JSX.Element {
  const resolver = useTrackerReferenceResolver();
  if (!resolver) return <TrackerReferenceReadOnlyChip {...props} />;
  switch (props.view) {
    case 'card':
      return (
        <SelectableBlock nodeKey={props.nodeKey}>
          <LiveCard resolver={resolver} referenceKey={props.referenceKey} />
        </SelectableBlock>
      );
    case 'statements':
      return (
        <SelectableBlock nodeKey={props.nodeKey}>
          <LiveStatements resolver={resolver} referenceKey={props.referenceKey} />
        </SelectableBlock>
      );
    default:
      return <InlineReference resolver={resolver} referenceKey={props.referenceKey} />;
  }
}

function InlineReference(props: ResolverProps): JSX.Element {
  return useTrackerReferenceInlineAppearance() === 'quiet'
    ? <QuietLink {...props} />
    : <LiveChip {...props} />;
}

/** Block views have no caret inside them, so node selection needs its own cue. */
function SelectableBlock({ nodeKey, children }: { nodeKey: string; children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const selected = useTrackerReferenceNodeSelected(nodeKey, ref);
  const restoreEditorFocus = useTrackerReferenceEditorFocus();
  return (
    <div ref={ref} className="tracker-reference-block" data-selected={selected ? 'true' : 'false'}>
      <TrackerStateMenuFocusContext.Provider value={restoreEditorFocus}>
        {children}
      </TrackerStateMenuFocusContext.Provider>
    </div>
  );
}
