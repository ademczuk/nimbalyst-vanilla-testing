/**
 * The interactive control for one ask.
 *
 * Every type except `singleSelect` renders through the shared widget chrome or
 * the shipped `reorder` list, so an ask answered here behaves the same as the
 * equivalent field in a local prompt. `singleSelect` is the deliberate
 * exception -- see `FeedbackRespondOptionCards`.
 */

import React from 'react';
import {
  getFeedbackTextAnswerMaxLength,
  type FeedbackAnswer,
  type FeedbackAsk,
  type FeedbackAskArtifact,
} from '@nimbalyst/collab-protocol';
import {
  WidgetOptionList,
  WidgetOptionRow,
} from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets/shared/InteractiveWidgetChrome';
import { ReorderList } from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets/shared/ReorderList';

import {
  FeedbackRespondOptionCards,
  type FeedbackOptionPreviewRenderer,
} from './FeedbackRespondOptionCards';
import type {
  FeedbackArtifactDetailEntry,
  FeedbackArtifactDetailRenderer,
} from './FeedbackArtifactDetailPopover';

/**
 * Lazy, and for bundle size specifically -- unlike the desktop preview's lazy
 * import, which is about module-graph cost in tests.
 *
 * The popover pulls in `@floating-ui/react`. Imported statically it lands in
 * the `feedback-ui` entry's eager graph, which is budgeted and which it
 * overshot by two thirds on the first attempt. Nobody sees this component
 * without clicking expand, so it loads on that click.
 */
const LazyDetailPopover = React.lazy(async () => ({
  default: (await import('./FeedbackArtifactDetailPopover')).FeedbackArtifactDetailPopover,
}));

/**
 * The suspense fallback is nothing on purpose. The popover is an overlay: a
 * spinner where it will be is a flash of chrome in the middle of the screen,
 * and the chunk resolves in the time it takes the click to finish.
 */
const FeedbackArtifactDetailPopover: typeof LazyDetailPopover = ((props) => (
  <React.Suspense fallback={null}>
    <LazyDetailPopover {...props} />
  </React.Suspense>
)) as typeof LazyDetailPopover;
import type { FeedbackArtifactActionResolver } from './FeedbackArtifactSubjects';
import { OTHER_OPTION_ID } from '@nimbalyst/collab-client/feedback';

export interface FeedbackRespondAskFieldProps {
  ask: FeedbackAsk;
  answer?: FeedbackAnswer;
  onChange: (answer: FeedbackAnswer) => void;
  disabled?: boolean;
  renderOptionPreview?: FeedbackOptionPreviewRenderer;
  /** Opens a bound artifact; absent means no expand affordance is offered. */
  onExpandArtifact?: (artifact: FeedbackAskArtifact) => void;
  /**
   * Paints one artifact full-size for the detail popover.
   *
   * Supplied means expand opens the popover; absent means expand still opens a
   * tab, which is what every host did before the popover existed. That
   * fallback is why a host can adopt this one at a time rather than all at
   * once, and why the browser keeps a working expand button until it has an
   * inline document component of its own.
   */
  renderArtifactDetail?: FeedbackArtifactDetailRenderer;
  resolveArtifactAction?: FeedbackArtifactActionResolver;
}

/**
 * The popover's walkable list: every entry in this ask that has an artifact,
 * in ask order.
 *
 * Ask order, not artifact order. `artifacts` is a parallel array keyed by entry
 * id and nothing requires it to be sorted, so stepping "next" off the artifact
 * array would walk the options in whatever order the author happened to bind
 * them -- which reads as the arrows being broken.
 */
function detailEntries(
  artifacts: readonly FeedbackAskArtifact[] | undefined,
  entries: readonly { id: string; label: string }[],
): FeedbackArtifactDetailEntry[] {
  if (!artifacts?.length) return [];
  const detail: FeedbackArtifactDetailEntry[] = [];
  for (const entry of entries) {
    const artifact = artifacts.find((candidate) => candidate.entryId === entry.id);
    if (artifact) detail.push({ entryId: entry.id, artifact, label: entry.label });
  }
  return detail;
}

/** An opener for one reorder row, so ranked artifacts are reachable too. */
const ReorderArtifactButton: React.FC<{
  artifact: FeedbackAskArtifact;
  onExpand: (anchor: HTMLElement | null) => void;
}> = ({ artifact, onExpand }) => (
  <button
    type="button"
    data-testid="feedback-respond-reorder-open"
    aria-label={`Open ${artifact.label}`}
    onClick={(event) => onExpand(event.currentTarget)}
    className="feedback-respond-reorder-artifact-button shrink-0 rounded border border-nim bg-nim px-1.5 py-0.5 text-[0.6875rem] text-nim-muted cursor-pointer hover:text-nim"
  >
    Open
  </button>
);

export const FeedbackRespondAskField: React.FC<FeedbackRespondAskFieldProps> = ({
  ask,
  answer,
  onChange,
  disabled = false,
  renderOptionPreview,
  onExpandArtifact,
  renderArtifactDetail,
  resolveArtifactAction,
}) => {
  const artifacts = 'artifacts' in ask ? ask.artifacts : undefined;

  /**
   * Which artifact is open in the detail popover, and what it grew from.
   *
   * Owned here rather than in the cards because stepping between options is a
   * property of the *ask* -- the popover needs every entry in the ask to walk
   * them, and a card only knows about itself.
   */
  const [expanded, setExpanded] = React.useState<
    { entryId: string; anchor: HTMLElement | null } | null
  >(null);

  const handleExpand = React.useCallback(
    (artifact: FeedbackAskArtifact, anchor: HTMLElement | null) => {
      // Without a detail renderer the popover has nothing to paint, so expand
      // keeps its old meaning and opens a tab.
      if (!renderArtifactDetail) {
        const open = resolveArtifactAction?.(artifact).open;
        if (open) open();
        else onExpandArtifact?.(artifact);
        return;
      }
      setExpanded({ entryId: artifact.entryId, anchor });
    },
    [renderArtifactDetail, resolveArtifactAction, onExpandArtifact],
  );

  switch (ask.type) {
    case 'singleSelect': {
      const selectedId = answer?.type === 'singleSelect' ? answer.selectedId : undefined;
      const otherText = answer?.type === 'singleSelect' ? (answer.otherText ?? '') : '';
      return (
        <div className="feedback-respond-single-select flex flex-col gap-2">
          <FeedbackRespondOptionCards
            askId={ask.id}
            options={ask.options}
            artifacts={artifacts}
            selectedId={selectedId}
            disabled={disabled}
            renderPreview={renderOptionPreview}
            onExpand={handleExpand}
            resolveAction={resolveArtifactAction}
            onSelect={(optionId) =>
              onChange({ type: 'singleSelect', selectedId: optionId })}
          />
          {expanded && renderArtifactDetail && (
            <FeedbackArtifactDetailPopover
              entries={detailEntries(
                artifacts,
                ask.options.map((option) => ({ id: option.id, label: option.label })),
              )}
              activeEntryId={expanded.entryId}
              onActiveEntryChange={(entryId) =>
                setExpanded((current) => (current ? { ...current, entryId } : current))}
              onDismiss={() => setExpanded(null)}
              anchor={expanded.anchor}
              renderArtifact={renderArtifactDetail}
              selectedId={selectedId}
              disabled={disabled}
              onSelect={(entryId) =>
                onChange({ type: 'singleSelect', selectedId: entryId })}
              onOpenInTab={onExpandArtifact}
            />
          )}
          {ask.allowOther && (
            <input
              type="text"
              data-testid="feedback-respond-other"
              value={otherText}
              disabled={disabled}
              placeholder="Something else…"
              onChange={(event) =>
                onChange({
                  type: 'singleSelect',
                  selectedId: OTHER_OPTION_ID,
                  otherText: event.target.value,
                })}
              className="feedback-respond-other-input w-full rounded border border-nim bg-nim px-2.5 py-2 text-[0.8125rem] text-nim placeholder-nim-faint focus:border-nim-primary focus:outline-none disabled:opacity-50"
            />
          )}
        </div>
      );
    }

    case 'multiSelect': {
      const selectedIds = answer?.type === 'multiSelect' ? answer.selectedIds : [];
      const max = ask.maxSelected ?? ask.items.length;
      return (
        <WidgetOptionList>
          {ask.items.map((item) => {
            const selected = selectedIds.includes(item.id);
            return (
              <WidgetOptionRow
                key={item.id}
                testId="feedback-respond-multi-option"
                dataAttributes={{ 'data-option-id': item.id }}
                label={item.title}
                description={item.subtitle}
                selected={selected}
                disabled={disabled || (!selected && selectedIds.length >= max)}
                onSelect={() =>
                  onChange({
                    type: 'multiSelect',
                    selectedIds: selected
                      ? selectedIds.filter((id) => id !== item.id)
                      : [...selectedIds, item.id],
                  })}
              />
            );
          })}
        </WidgetOptionList>
      );
    }

    case 'reorder': {
      const state = answer?.type === 'reorder'
        ? { orderedIds: answer.orderedIds, removedIds: answer.removedIds }
        : { orderedIds: ask.items.map((item) => item.id), removedIds: [] };
      return (
        <>
        <ReorderList
          items={ask.items}
          state={state}
          minItems={ask.minItems}
          disabled={disabled}
          rootClassName="feedback-respond-reorder"
          testIds={{
            root: `feedback-respond-reorder-${ask.id}`,
            row: 'feedback-respond-reorder-row',
            remove: 'feedback-respond-reorder-remove',
          }}
          renderTrailing={onExpandArtifact || resolveArtifactAction || renderArtifactDetail
            ? (itemId) => {
                const artifact = artifacts?.find((entry) => entry.entryId === itemId);
                if (!artifact) return null;
                if (resolveArtifactAction && !resolveArtifactAction(artifact).open) return null;
                return (
                  <ReorderArtifactButton
                    artifact={artifact}
                    onExpand={(target) => handleExpand(artifact, target)}
                  />
                );
              }
            : undefined}
          onChange={(next) => onChange({ type: 'reorder', ...next })}
        />
        {expanded && renderArtifactDetail && (
          <FeedbackArtifactDetailPopover
            entries={detailEntries(
              artifacts,
              // Ranking order, so stepping through the popover walks the list
              // the way it currently reads on screen rather than the order the
              // ask was authored in.
              state.orderedIds
                .map((id) => ask.items.find((item) => item.id === id))
                .filter((item): item is NonNullable<typeof item> => item !== undefined)
                .map((item) => ({ id: item.id, label: item.title })),
            )}
            activeEntryId={expanded.entryId}
            onActiveEntryChange={(entryId) =>
              setExpanded((current) => (current ? { ...current, entryId } : current))}
            onDismiss={() => setExpanded(null)}
            anchor={expanded.anchor}
            renderArtifact={renderArtifactDetail}
            // No `onSelect`: ranking is done by dragging the list, so a "pick
            // this" button in the footer would be a second, contradictory way
            // to answer the same ask.
            onOpenInTab={onExpandArtifact}
          />
        )}
        </>
      );
    }

    case 'editText': {
      const text = answer?.type === 'editText' ? answer.text : ask.initialText;
      return (
        <textarea
          data-testid="feedback-respond-edit-text"
          value={text}
          rows={3}
          disabled={disabled}
          placeholder={ask.placeholder}
          maxLength={getFeedbackTextAnswerMaxLength(ask.maxLength)}
          onChange={(event) =>
            onChange({
              type: 'editText',
              text: event.target.value,
              edited: event.target.value !== ask.initialText,
            })}
          className="feedback-respond-edit-text w-full resize-y rounded border border-nim bg-nim px-2.5 py-2 text-[0.8125rem] text-nim placeholder-nim-faint focus:border-nim-primary focus:outline-none disabled:opacity-50 select-text"
        />
      );
    }

    case 'confirm': {
      const value = answer?.type === 'confirm' ? answer.value : undefined;
      return (
        <WidgetOptionList>
          <WidgetOptionRow
            testId="feedback-respond-confirm-yes"
            label="Yes"
            selected={value === true}
            disabled={disabled}
            onSelect={() => onChange({ type: 'confirm', value: true })}
          />
          <WidgetOptionRow
            testId="feedback-respond-confirm-no"
            label="No"
            selected={value === false}
            disabled={disabled}
            onSelect={() => onChange({ type: 'confirm', value: false })}
          />
        </WidgetOptionList>
      );
    }

    case 'rating': {
      const value = answer?.type === 'rating' ? answer.value : undefined;
      const step = ask.step && ask.step > 0 ? ask.step : 1;
      const steps: number[] = [];
      for (let candidate = ask.min; candidate <= ask.max; candidate += step) {
        steps.push(candidate);
      }
      return (
        <div className="feedback-respond-rating flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-1.5">
            {steps.map((candidate) => (
              <button
                key={candidate}
                type="button"
                data-testid="feedback-respond-rating-step"
                data-value={candidate}
                disabled={disabled}
                aria-pressed={value === candidate}
                onClick={() => onChange({ type: 'rating', value: candidate })}
                className={
                  value === candidate
                    ? 'min-w-8 rounded border border-nim-primary bg-nim-primary px-2 py-1 text-xs font-semibold text-nim-on-primary cursor-pointer disabled:opacity-50'
                    : 'min-w-8 rounded border border-nim bg-nim-secondary px-2 py-1 text-xs text-nim-muted cursor-pointer hover:bg-nim-hover disabled:opacity-50'
                }
              >
                {candidate}
              </button>
            ))}
          </div>
          {(ask.minLabel || ask.maxLabel) && (
            <div className="flex justify-between text-[0.6875rem] text-nim-faint">
              <span>{ask.minLabel}</span>
              <span>{ask.maxLabel}</span>
            </div>
          )}
        </div>
      );
    }
  }
};
