/**
 * Quick Track — one global, keyboard-driven surface for creating a tracker item
 * of any type from anywhere in the app.
 *
 * Two stages, both keyboard-driven: the popup opens on a type filter (type a
 * few letters, Enter picks), then collapses to a chip and puts the caret in the
 * title. The rapid-fire loop is the point — Enter creates, keeps the popup open
 * and keeps the type, so entering six bugs after a testing pass is six
 * sentences and six Enters. `Cmd+Enter` creates and closes into the new item.
 *
 * Shares its chrome with the session launch popup via `LaunchPopupShell`, and
 * is deliberately NOT registered with DialogProvider — it needs to coexist with
 * whatever is on screen, not participate in modal mutual exclusion.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { usePostHog } from 'posthog-js/react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import {
  buildTrackerCreatePayload,
  formatTrackerValidationErrors,
  globalRegistry,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/models';
import { TrackerFieldPills } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/TrackerFieldPills';
import { useTrackerRelationshipCandidates } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/useTrackerRelationshipCandidates';
import { getTypeIcon } from '@nimbalyst/runtime/plugins/TrackerPlugin/components/trackerColumns';
import { LaunchPopupShell, useLaunchPopupToggle } from '../LaunchPopup/LaunchPopupShell';
import { errorNotificationService } from '../../services/ErrorNotificationService';
import { trackerQuickCreateRequestAtom } from '../../store/atoms/appCommands';
import {
  createEmptyTrackerQuickCreateDraft,
  trackerQuickCreateDraftAtom,
} from '../../store/atoms/trackerQuickCreate';
import { setTrackerModeLayoutAtom } from '../../store/atoms/trackers';
import { setWindowModeAtom } from '../../store/atoms/windowMode';
import { createCollectionItem } from '../TrackerMode/createCollectionItem';
import { TrackerDuplicateStrip } from './TrackerDuplicateStrip';
import { TrackerQuickCreateCreatedStrip } from './TrackerQuickCreateCreatedStrip';
import { MemorySuggestionHint } from './MemorySuggestionHint';
import { TrackerTypePicker } from './TrackerTypePicker';
import { rankTrackerTypes } from './rankTrackerTypes';
import { useTrackerDuplicates } from './useTrackerDuplicates';
import {
  carryStickyValues,
  carryValuesAcrossTypes,
  splitQuickCreateFields,
  stickyQuickCreateFieldNames,
} from './trackerQuickCreateFields';

interface TrackerQuickCreatePopupProps {
  workspacePath: string | null;
}

export const TrackerQuickCreatePopup: React.FC<TrackerQuickCreatePopupProps> = ({ workspacePath }) => {
  const requestVersion = useAtomValue(trackerQuickCreateRequestAtom);
  const workspaceKey = workspacePath ?? '';
  const draftAtom = useMemo(() => trackerQuickCreateDraftAtom(workspaceKey), [workspaceKey]);
  const [draft, setDraft] = useAtom(draftAtom);
  const setWindowMode = useSetAtom(setWindowModeAtom);
  const setTrackerLayout = useSetAtom(setTrackerModeLayoutAtom);
  const posthog = usePostHog();

  const [open, setOpen] = useLaunchPopupToggle(requestVersion, { enabled: Boolean(workspacePath) });
  const [error, setError] = useState<string | null>(null);
  const [createdIds, setCreatedIds] = useState<string[]>([]);
  const [duplicatesExpanded, setDuplicatesExpanded] = useState(true);
  const [activeDuplicateIndex, setActiveDuplicateIndex] = useState(-1);
  const titleRef = useRef<HTMLInputElement>(null);
  const typeSearchRef = useRef<HTMLInputElement>(null);

  // Stage 1 picks the type, stage 2 captures the content. Every open starts on
  // the picker; a create keeps the type and stays in stage 2.
  const [stage, setStage] = useState<'type' | 'content'>('type');
  const [typeQuery, setTypeQuery] = useState('');
  const [typeIndex, setTypeIndex] = useState(0);

  // Registry has no atom; every tracker surface subscribes and bumps a version.
  const [registryVersion, setRegistryVersion] = useState(0);
  useEffect(() => globalRegistry.onChange(() => setRegistryVersion((v) => v + 1)), []);

  const types = useMemo(
    // registryVersion is the subscription signal; the registry itself is mutable.
    () => globalRegistry.getAll().filter((model) => model.creatable !== false && !model.archived),
    [registryVersion],
  );

  const typeChoices = useMemo(
    () => rankTrackerTypes(types, typeQuery, draft.recentTypes),
    [types, typeQuery, draft.recentTypes],
  );
  // A filter that eliminated the active row must not leave a stale index behind.
  const activeTypeIndex = Math.min(typeIndex, Math.max(typeChoices.length - 1, 0));

  const selectedType = draft.type && globalRegistry.get(draft.type) ? draft.type : null;
  const model = selectedType ? globalRegistry.get(selectedType) : undefined;

  const { primary, more } = useMemo(
    () => (selectedType ? splitQuickCreateFields(selectedType, model) : { primary: [], more: [] }),
    [selectedType, model, registryVersion],
  );
  const relationshipCandidates = useTrackerRelationshipCandidates(null, [...primary, ...more]);
  const carriedFieldNames = useMemo(() => new Set(draft.carriedFields), [draft.carriedFields]);

  const { matches, semanticAvailable } = useTrackerDuplicates(workspacePath, draft.title, open);
  const duplicateMatchIdentity = matches.map((match) => match.entry.id).join('\0');

  useEffect(() => {
    setActiveDuplicateIndex(-1);
    setDuplicatesExpanded(true);
  }, [duplicateMatchIdentity]);

  // One "shown" event per popup run that produced suggestions, so the three
  // outcomes (shown / opened / ignored-and-created) stay comparable.
  const reportedShownRef = useRef(false);
  useEffect(() => {
    if (!open) {
      reportedShownRef.current = false;
      return;
    }
    if (matches.length === 0 || reportedShownRef.current) return;
    reportedShownRef.current = true;
    posthog?.capture('tracker_quick_create_duplicates_shown', {
      matchCount: matches.length,
      semanticAvailable,
    });
  }, [open, matches.length, semanticAvailable, posthog]);

  useEffect(() => {
    if (open) setCreatedIds([]);
    // Every open starts on the type picker, pre-pointed at the last type used
    // so the common case is one Enter away.
    setStage('type');
    setTypeQuery('');
    setTypeIndex(0);
    setError(null);
  }, [open]);

  useEffect(() => {
    setOpen(false);
    setCreatedIds([]);
    setError(null);
  }, [workspacePath, setOpen]);

  const openItem = useCallback(
    (itemId: string) => {
      setWindowMode('tracker');
      setTrackerLayout({ selectedType: 'all', selectedItemId: itemId });
    },
    [setWindowMode, setTrackerLayout],
  );

  const selectType = useCallback(
    (nextType: string) => {
      setDraft((current) => {
        if (current.type === nextType) return current;
        const previousModel = current.type ? globalRegistry.get(current.type) : undefined;
        return {
          ...current,
          type: nextType,
          // Title and description survive a type switch; field values survive
          // only where the target schema declares the same field.
          fields: carryValuesAcrossTypes(current.fields, globalRegistry.get(nextType), previousModel),
          carriedFields: [],
          showMoreFields: false,
        };
      });
      setStage('content');
      // Leaving the stage clean means re-entering the picker always starts from
      // the full, recency-ordered list.
      setTypeQuery('');
      requestAnimationFrame(() => titleRef.current?.focus());
    },
    [setDraft],
  );

  const openTypePicker = useCallback(() => {
    setStage('type');
    setTypeQuery('');
    setTypeIndex(Math.max(typeChoices.findIndex((choice) => choice.model.type === selectedType), 0));
    requestAnimationFrame(() => typeSearchRef.current?.focus());
  }, [typeChoices, selectedType]);

  const setFieldValue = useCallback(
    (name: string, value: unknown) => {
      setDraft((current) => ({
        ...current,
        fields: { ...current.fields, [name]: value },
        // Touching a carried value makes it this item's own.
        carriedFields: current.carriedFields.filter((field) => field !== name),
      }));
    },
    [setDraft],
  );

  const handleCreate = useCallback(
    (closeAfter: boolean) => {
      if (!workspacePath || !selectedType || !draft.title.trim()) return;

      const built = buildTrackerCreatePayload(
        selectedType,
        { title: draft.title, description: draft.description, fields: draft.fields },
        { workspacePath },
      );
      if (!built.ok) {
        setError(formatTrackerValidationErrors(built.errors));
        return;
      }

      const { payload } = built;
      setError(null);
      posthog?.capture('tracker_quick_create_item_created', {
        trackerType: selectedType,
        sharing: payload.sharing,
        duplicatesShown: matches.length,
        closedAfterCreate: closeAfter,
      });

      // Fire-and-forget, like the session popup: an error surfaces as a
      // notification rather than blocking the next entry.
      void window.electronAPI.documentService
        .createTrackerItem(payload)
        .then((result) => {
          if (!result.success) throw new Error(result.error || 'Failed to create the tracker item.');
        })
        .catch((createError: unknown) => {
          console.error('[TrackerQuickCreatePopup] Failed to create tracker item:', createError);
          errorNotificationService.showError(
            'Could not create the item',
            createError instanceof Error ? createError.message : 'Failed to create the tracker item.',
          );
        });

      setCreatedIds((current) => [...current, payload.id]);

      const stickyNames = stickyQuickCreateFieldNames(selectedType, model);
      const sticky = carryStickyValues(draft.fields, stickyNames);
      setDraft((current) => ({
        ...current,
        type: selectedType,
        title: '',
        description: '',
        fields: sticky.values,
        carriedFields: sticky.carried,
        recentTypes: [selectedType, ...current.recentTypes.filter((type) => type !== selectedType)],
      }));

      if (closeAfter) {
        setOpen(false);
        openItem(payload.id);
        return;
      }
      titleRef.current?.focus();
    },
    [workspacePath, selectedType, draft, model, matches.length, posthog, setDraft, setOpen, openItem],
  );

  const handleOpenDuplicate = useCallback(
    (itemId: string) => {
      posthog?.capture('tracker_quick_create_duplicate_opened', { matchCount: matches.length });
      setDraft(createEmptyTrackerQuickCreateDraft());
      setOpen(false);
      openItem(itemId);
    },
    [posthog, matches.length, setDraft, setOpen, openItem],
  );

  const handleTitleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      // Backspace on an empty title steps back to the type picker, the way
      // backspacing out of a token field works elsewhere.
      if (event.key === 'Backspace' && event.currentTarget.value === '') {
        event.preventDefault();
        openTypePicker();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (activeDuplicateIndex >= 0 && matches[activeDuplicateIndex]) {
          handleOpenDuplicate(matches[activeDuplicateIndex].entry.id);
          return;
        }
        handleCreate(event.metaKey || event.ctrlKey);
        return;
      }
      if (event.key === 'ArrowDown' && matches.length > 0) {
        event.preventDefault();
        setDuplicatesExpanded(true);
        setActiveDuplicateIndex((current) => Math.min(current + 1, matches.length - 1));
        return;
      }
      if (event.key === 'ArrowUp' && activeDuplicateIndex >= 0) {
        event.preventDefault();
        setActiveDuplicateIndex((current) => current - 1);
      }
    },
    [activeDuplicateIndex, matches, handleCreate, handleOpenDuplicate, openTypePicker],
  );

  // Popup-wide, not input-scoped: changing the type must work from the
  // description and the field pills too.
  const handlePopupKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 't') {
        event.preventDefault();
        openTypePicker();
      }
    },
    [openTypePicker],
  );

  if (!workspacePath) return null;

  const sharingNote = model?.sharing === 'team'
    ? (model.draftByDefault ? 'Saved as a draft' : 'Publishes to the team on create')
    : null;
  const modifierLabel = navigator.platform.startsWith('Mac') ? 'Cmd' : 'Ctrl';

  return (
    <LaunchPopupShell
      open={open}
      onOpenChange={setOpen}
      title={(
        <div className="tracker-quick-create-heading flex min-w-0 items-center gap-1.5">
          <span className="shrink-0">New</span>
          <button
            type="button"
            data-testid="tracker-quick-create-type-chip"
            className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 font-semibold text-[var(--nim-text)] transition-colors hover:bg-[var(--nim-bg-hover)]"
            title={`Change type (${modifierLabel}+T)`}
            onClick={openTypePicker}
          >
            {selectedType && <MaterialSymbol icon={getTypeIcon(selectedType)} size={13} />}
            <span className="truncate">{model?.displayName ?? 'type'}</span>
            <MaterialSymbol icon="expand_more" size={13} />
          </button>
          {sharingNote && (
            <span className="tracker-quick-create-sharing truncate text-[11px] font-normal text-[var(--nim-text-muted)]">
              {sharingNote}
            </span>
          )}
        </div>
      )}
      ariaLabel="New tracker item"
      closeLabel="Close tracker quick create"
      classPrefix="tracker-quick-create-popup"
      width="min(640px, calc(100vw - 32px))"
      resetKey={workspacePath}
      onOpened={() => typeSearchRef.current?.focus()}
    >
      {stage === 'type' ? (
        <TrackerTypePicker
          choices={typeChoices}
          activeIndex={activeTypeIndex}
          query={typeQuery}
          onQueryChange={(next) => {
            setTypeQuery(next);
            setTypeIndex(0);
          }}
          onActiveIndexChange={setTypeIndex}
          onSelect={selectType}
          selectedType={selectedType}
          inputRef={typeSearchRef}
          footer={
            <div className="tracker-quick-create-type-hint flex items-center justify-between gap-2 border-t border-[var(--nim-border)] px-3 py-2 text-[11px] text-[var(--nim-text-muted)]">
              <span className="truncate">
                {draft.title.trim() ? `Keeping “${draft.title.trim()}”` : 'Type to filter, Enter to pick'}
              </span>
              <span className="shrink-0">↑↓ to move</span>
            </div>
          }
        />
      ) : (
        <div className="tracker-quick-create-body flex flex-col" onKeyDown={handlePopupKeyDown}>
          <input
            ref={titleRef}
            type="text"
            data-testid="tracker-quick-create-title"
            className="tracker-quick-create-title select-text bg-transparent px-3 py-2 text-sm font-bold text-[var(--nim-text)] outline-none placeholder:font-normal placeholder:text-[var(--nim-text-muted)]"
            placeholder="Title"
            value={draft.title}
            onChange={(event) => {
              // Typing returns Enter to its primary action. A duplicate row
              // selected before the edit must not stay armed invisibly.
              setActiveDuplicateIndex(-1);
              setDraft((current) => ({ ...current, title: event.target.value }));
            }}
            onKeyDown={handleTitleKeyDown}
          />

          <TrackerDuplicateStrip
            matches={matches}
            expanded={duplicatesExpanded}
            onToggleExpanded={() => setDuplicatesExpanded((value) => !value)}
            activeIndex={activeDuplicateIndex}
            onOpenItem={handleOpenDuplicate}
            onHoverItem={setActiveDuplicateIndex}
            footer={
              semanticAvailable ? undefined : <MemorySuggestionHint workspacePath={workspacePath} />
            }
          />

          <textarea
            data-testid="tracker-quick-create-description"
            className="tracker-quick-create-description select-text resize-none bg-transparent px-3 py-2 text-xs text-[var(--nim-text)] outline-none placeholder:text-[var(--nim-text-muted)]"
            rows={2}
            placeholder="Content"
            value={draft.description}
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
          />

          {selectedType && primary.length > 0 && (
            <TrackerFieldPills
              fields={primary}
              values={draft.fields}
              relationshipCandidates={relationshipCandidates}
              onSave={setFieldValue}
              onCreateCollection={(title, type) => createCollectionItem({ workspacePath, type, title })}
              carriedFieldNames={carriedFieldNames}
              className="tracker-quick-create-fields border-t border-[var(--nim-border)] px-3 py-2"
              testIdBase="tracker-quick-create-field"
            />
          )}

          {more.length > 0 && (
            <>
              <button
                type="button"
                data-testid="tracker-quick-create-more-fields"
                className="flex items-center gap-1 px-3 py-1.5 text-left text-xs text-[var(--nim-text-muted)] hover:text-[var(--nim-text)]"
                aria-expanded={draft.showMoreFields}
                onClick={() => setDraft((current) => ({ ...current, showMoreFields: !current.showMoreFields }))}
              >
                <MaterialSymbol icon={draft.showMoreFields ? 'expand_more' : 'chevron_right'} size={14} />
                More fields
              </button>
              {draft.showMoreFields && (
                <TrackerFieldPills
                  fields={more}
                  values={draft.fields}
                  relationshipCandidates={relationshipCandidates}
                  onSave={setFieldValue}
                  onCreateCollection={(title, type) => createCollectionItem({ workspacePath, type, title })}
                  carriedFieldNames={carriedFieldNames}
                  className="tracker-quick-create-more-field-pills px-3 pb-2"
                  testIdBase="tracker-quick-create-more-field"
                />
              )}
            </>
          )}

          {error && (
            <div className="tracker-quick-create-error select-text border-t border-[var(--nim-border)] px-3 py-2 text-xs text-[var(--nim-error)]" role="alert">
              {error}
            </div>
          )}

          <div className="tracker-quick-create-actions flex items-center justify-between border-t border-[var(--nim-border)] px-3 py-2">
            <span className="text-[11px] text-[var(--nim-text-muted)]">
              Enter to add another, {modifierLabel}+Enter to open it, {modifierLabel}+T to change type
            </span>
            <button
              type="button"
              data-testid="tracker-quick-create-submit"
              className="rounded bg-nim-primary px-2.5 py-1 text-xs text-white hover:bg-nim-primary-hover disabled:opacity-50"
              disabled={!draft.title.trim() || !selectedType}
              onClick={() => handleCreate(false)}
            >
              Add
            </button>
          </div>

          <TrackerQuickCreateCreatedStrip createdIds={createdIds} onOpenItem={openItem} />
        </div>
      )}
    </LaunchPopupShell>
  );
};

export default TrackerQuickCreatePopup;
