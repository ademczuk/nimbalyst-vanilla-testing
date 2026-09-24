/**
 * The `#` tracker-reference typeahead, shared by every host that can search
 * tracker items. Desktop's TrackerPlugin feeds it the runtime tracker store; the
 * browser editor feeds it the tracker-room resolver. The host owns search and
 * icons; this owns the trigger, the menu, and what gets inserted.
 *
 * It also answers {@link OPEN_TRACKER_REFERENCE_PICKER_COMMAND}: the slash-menu
 * entries type a `#` for the writer and remember which view (inline chip or
 * embedded card) the pick should insert.
 */

import type { JSX } from 'react';
import * as React from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  type LexicalCommand,
  type LexicalEditor,
  type TextNode,
} from 'lexical';

import { TypeaheadMenuPlugin } from '../../editor/plugins/TypeaheadPlugin/TypeaheadMenuPlugin';
import type { TypeaheadMenuOption } from '../../editor/plugins/TypeaheadPlugin/TypeaheadMenu';
import type { UserCommand } from '../../editor/types/PluginTypes';
import type { TrackerReferenceView } from './TrackerReferenceNode';
import { $replaceTrackerReferenceTrigger, readTrackerReferenceTrigger } from './trackerReferencePicker';
import type { TrackerReferenceSearchResult } from './trackerReferenceSearch';

/** Open the `#` picker at the caret; the pick inserts a reference in this view. */
export const OPEN_TRACKER_REFERENCE_PICKER_COMMAND: LexicalCommand<TrackerReferenceView | undefined> =
  createCommand('OPEN_TRACKER_REFERENCE_PICKER_COMMAND');

/** Slash-menu entries for hosts that mount {@link TrackerReferenceTypeahead}. */
export const TRACKER_REFERENCE_USER_COMMANDS: ReadonlyArray<UserCommand> = [
  {
    title: 'Tracker Item Reference',
    description: 'Link a tracker item inline',
    icon: 'sell',
    keywords: ['tracker', 'item', 'reference', 'link', 'issue', 'mention'],
    command: OPEN_TRACKER_REFERENCE_PICKER_COMMAND as LexicalCommand<unknown>,
    payload: 'chip',
  },
  {
    title: 'Embedded Tracker Item',
    description: 'Embed a tracker item as a live card',
    icon: 'dashboard',
    keywords: ['tracker', 'item', 'embed', 'card', 'issue'],
    command: OPEN_TRACKER_REFERENCE_PICKER_COMMAND as LexicalCommand<unknown>,
    payload: 'card',
  },
];

export interface TrackerReferenceTypeaheadProps {
  /** Rank items for the raw typed query (may carry a `type:` scope). */
  search(query: string | null): TrackerReferenceSearchResult;
  /** Material Symbols ligature for a tracker type. */
  iconForType(type: string): string;
}

const NO_MATCHES_ID = '__no-tracker-matches__';

function triggerFn(_text: string, editor: LexicalEditor) {
  return readTrackerReferenceTrigger(editor);
}

export function TrackerReferenceTypeahead({
  search,
  iconForType,
}: TrackerReferenceTypeaheadProps): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = React.useState<string | null>(null);
  // The view the next pick inserts. Set by the slash command, and reset when
  // the menu closes so a later plain `#` inserts a chip again -- but only a
  // close after the menu has opened: the plugin also reports a close on the
  // updates before it opens, which would drop the view on its way in.
  const pendingViewRef = React.useRef<TrackerReferenceView>('chip');
  const openedSinceCommandRef = React.useRef(true);

  React.useEffect(() => editor.registerCommand(
    OPEN_TRACKER_REFERENCE_PICKER_COMMAND,
    (view) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        pendingViewRef.current = view ?? 'chip';
        openedSinceCommandRef.current = false;
        selection.insertText('#');
      });
      return true;
    },
    COMMAND_PRIORITY_EDITOR,
  ), [editor]);

  const { options, typeFilter, searchQuery } = search(query);

  const menuOptions: TypeaheadMenuOption[] = options.length > 0
    ? options.map((item) => {
        const keyLabel = item.issueKey ?? item.referenceKey;
        return {
          id: item.referenceKey,
          label: item.title || keyLabel,
          description: [keyLabel, item.type, item.status].filter(Boolean).join(' · '),
          icon: <span className="material-symbols-outlined">{iconForType(item.type) || 'sell'}</span>,
          keywords: [item.referenceKey, keyLabel, item.title, item.type].filter(Boolean) as string[],
          onSelect: () => {}, // Required by TypeaheadMenuOption but handled in handleSelectOption
        };
      })
    : [{
        // A disabled hint rather than an empty floating box.
        id: NO_MATCHES_ID,
        label: typeFilter
          ? (searchQuery ? `No ${typeFilter} items match “${searchQuery}”` : `No ${typeFilter} items`)
          : (searchQuery ? `No tracker items match “${searchQuery}”` : 'No tracker items yet'),
        onSelect: () => {},
        disabled: true,
      }];

  // Small header confirming an active type scope.
  const header = typeFilter ? (
    <div className="tracker-typeahead-filter-hint">
      <span className="material-symbols-outlined">filter_list</span>
      Filtering by type: <strong>{typeFilter}</strong>
    </div>
  ) : undefined;

  const handleSelectOption = React.useCallback(
    (option: TypeaheadMenuOption, _textNode: TextNode | null, closeMenu: () => void, matchingString: string) => {
      if (option.disabled) {
        closeMenu();
        return;
      }
      const view = pendingViewRef.current;
      // option.id is the reference key (issue key or record id).
      editor.update(() => {
        $replaceTrackerReferenceTrigger(matchingString, option.id, view);
      });
      closeMenu();
    },
    [editor],
  );

  const handleOpen = React.useCallback(() => {
    openedSinceCommandRef.current = true;
  }, []);

  const handleClose = React.useCallback(() => {
    if (openedSinceCommandRef.current) pendingViewRef.current = 'chip';
  }, []);

  return (
    <TypeaheadMenuPlugin
      options={menuOptions}
      triggerFn={triggerFn}
      onQueryChange={setQuery}
      onSelectOption={handleSelectOption}
      onOpen={handleOpen}
      onClose={handleClose}
      header={header}
      shouldSplitNodeWithQuery={false}
    />
  );
}
