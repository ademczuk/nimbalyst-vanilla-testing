/**
 * Inserting tracker references in the browser editor: the `#` typeahead and the
 * two slash-menu entries (inline reference, embedded card).
 *
 * Desktop gets these from its TrackerPlugin over the runtime tracker store. This
 * host has no such store; it has the resolver the host passes as
 * `trackerReferences`, and its `search` is what makes insertion possible. The
 * menu, trigger and inserted nodes are the shared runtime ones, so a document
 * written here serializes exactly as one written on desktop.
 *
 * Enabled per mount: the component renders nothing, and the slash entries are
 * withdrawn, unless the mounted editor's resolver can search.
 */

import React from 'react';

import { registerExtensionEditorComponent } from '@nimbalyst/runtime/editor/extensions/extensionEditorComponentsStore';
import { setExtensionContributions } from '@nimbalyst/runtime/editor/extensions/extensionContributionsStore';
import {
  TRACKER_REFERENCE_USER_COMMANDS,
  TrackerReferenceTypeahead,
} from '@nimbalyst/runtime/plugins/TrackerLinkPlugin/TrackerReferenceTypeahead';
import {
  useTrackerReferenceResolver,
  type TrackerReferenceResolver,
} from '@nimbalyst/collab-client/trackers-ui/references';

const SOURCE = 'browser-tracker-reference-insertion';

/**
 * The slash-menu store is global, so the entries are published while at least
 * one mounted editor can search and withdrawn when the last one unmounts.
 */
let searchableMounts = 0;

function retainSlashEntries(): () => void {
  searchableMounts += 1;
  if (searchableMounts === 1) {
    setExtensionContributions(SOURCE, { userCommands: TRACKER_REFERENCE_USER_COMMANDS });
  }
  return () => {
    searchableMounts -= 1;
    if (searchableMounts === 0) setExtensionContributions(SOURCE, undefined);
  };
}

function SearchableTrackerReferenceTypeahead({
  resolver,
}: {
  resolver: TrackerReferenceResolver & Required<Pick<TrackerReferenceResolver, 'search'>>;
}): React.JSX.Element {
  // Re-rank when the room's items change while the menu is open.
  const [version, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => resolver.subscribe(bump), [resolver]);
  React.useEffect(() => retainSlashEntries(), []);

  const search = React.useCallback(
    (query: string | null) => resolver.search(query),
    // `version` invalidates the callback so the typeahead re-renders fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolver, version],
  );
  const iconForType = React.useCallback(
    (type: string) => resolver.typeInfo(type).icon || 'sell',
    [resolver],
  );
  return <TrackerReferenceTypeahead search={search} iconForType={iconForType} />;
}

export function BrowserTrackerReferenceInsertion(): React.JSX.Element | null {
  const resolver = useTrackerReferenceResolver();
  if (!resolver?.search) return null;
  return (
    <SearchableTrackerReferenceTypeahead
      resolver={resolver as TrackerReferenceResolver & Required<Pick<TrackerReferenceResolver, 'search'>>}
    />
  );
}

let registered = false;

/**
 * Publish the insertion UI into the editor's component slot. Idempotent; a
 * function the entry point calls for the reason `./referenceNodes` documents.
 */
export function registerBrowserTrackerReferenceInsertion(): void {
  if (registered) return;
  registered = true;
  registerExtensionEditorComponent({ name: SOURCE, Component: BrowserTrackerReferenceInsertion });
}
