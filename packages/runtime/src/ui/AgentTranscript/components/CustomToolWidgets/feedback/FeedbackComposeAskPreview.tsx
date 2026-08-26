/**
 * Read-only preview of one ask, as the recipient will see it.
 *
 * The author is reviewing a draft here, not answering it, so nothing is
 * selectable -- the point is that the draft is small enough to check at a
 * glance before it leaves the machine. The respond surface renders the same
 * asks with the shipped interactive field controls.
 */

import React from 'react';
import type { FeedbackAsk, FeedbackAskArtifact } from '@nimbalyst/collab-protocol';
import { WidgetOptionList, WidgetOptionRow } from '../shared/InteractiveWidgetChrome';
import type {
  FeedbackComposeArtifactEntry,
  FeedbackComposeArtifactPopoverRenderer,
  FeedbackComposeArtifactRenderer,
} from '../InteractiveWidgetHost';

const StaticField: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="rounded border border-nim bg-nim-secondary px-2.5 py-2 text-[0.8125rem] text-nim-faint">
    {children}
  </div>
);

/**
 * One bound artifact, above the option it belongs to.
 *
 * Deliberately the same shape the recipient will see -- a preview panel over
 * the choice -- because the author is checking a draft, and a draft that looks
 * nothing like what gets delivered is not much of a check.
 *
 * It is not the *same component*: the respond cards live in `collab-client`,
 * which depends on this package, so importing them here would be a cycle. The
 * duplication is the panel and the frame, both of which are a few lines; the
 * parts worth sharing -- the placeholder, the scaling -- come through the
 * injected renderer.
 */
const ComposeArtifactCard: React.FC<{
  label: string;
  description?: string;
  preview: React.ReactNode;
  onExpand?: (anchor: HTMLElement | null) => void;
}> = ({ label, description, preview, onExpand }) => (
  <div
    data-testid="feedback-compose-option-card"
    className="feedback-compose-option-card relative overflow-hidden rounded-md border border-nim bg-nim-secondary"
  >
    {/*
      The picture is the button. The scaled preview is `pointer-events: none`,
      so nothing inside the artifact can take the click, which is what makes the
      whole panel a safe target -- and what made a 20px corner icon a needlessly
      small version of the same affordance.
    */}
    {onExpand ? (
      <button
        type="button"
        data-testid="feedback-compose-option-expand"
        aria-label={`Open ${label}`}
        onClick={(event) =>
          onExpand(event.currentTarget.closest<HTMLElement>('.feedback-compose-option-card'))}
        className="relative block h-44 w-full border-b border-nim bg-nim p-2.5 text-left cursor-zoom-in hover:ring-1 hover:ring-inset hover:ring-nim-primary"
      >
        {preview}
      </button>
    ) : (
      <div className="relative h-44 border-b border-nim bg-nim p-2.5">{preview}</div>
    )}
    <div className="flex flex-col gap-0.5 px-2.5 py-2">
      <span className="text-xs font-semibold leading-snug text-nim select-text">{label}</span>
      {description && (
        <span className="text-[0.6875rem] leading-snug text-nim-muted select-text">
          {description}
        </span>
      )}
    </div>
  </div>
);

const ComposeArtifactGrid: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    className="feedback-compose-option-cards grid gap-2.5"
    /* Sized to the options rather than to a fixed three; see the respond cards. */
    style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}
  >
    {children}
  </div>
);

function artifactFor(
  artifacts: readonly FeedbackAskArtifact[] | undefined,
  entryId: string,
): FeedbackAskArtifact | undefined {
  return artifacts?.find((entry) => entry.entryId === entryId);
}

export const FeedbackComposeAskPreview: React.FC<{
  ask: FeedbackAsk;
  renderArtifact?: FeedbackComposeArtifactRenderer;
  renderArtifactPopover?: FeedbackComposeArtifactPopoverRenderer;
}> = ({ ask, renderArtifact, renderArtifactPopover }) => {
  const artifacts = 'artifacts' in ask ? ask.artifacts : undefined;
  const showCards = Boolean(renderArtifact && artifacts?.length);

  /** Which artifact is open, and the card it grew from. */
  const [expanded, setExpanded] = React.useState<
    { entryId: string; anchor: HTMLElement | null } | null
  >(null);

  /**
   * Every entry with an artifact, in *ask* order rather than artifact order --
   * `artifacts` is a parallel array keyed by entry id and nothing sorts it, so
   * stepping off it would walk the options in whatever order the author bound
   * them, which reads as the arrows being broken.
   */
  const walkable = React.useMemo((): FeedbackComposeArtifactEntry[] => {
    if (!artifacts?.length) return [];
    const entries: Array<{ id: string; label: string }> =
      ask.type === 'singleSelect'
        ? ask.options.map((option) => ({ id: option.id, label: option.label }))
        : ask.type === 'reorder'
          ? ask.items.map((item) => ({ id: item.id, label: item.title }))
          : [];
    const out: FeedbackComposeArtifactEntry[] = [];
    for (const entry of entries) {
      const artifact = artifacts.find((candidate) => candidate.entryId === entry.id);
      if (artifact) out.push({ entryId: entry.id, artifact, label: entry.label });
    }
    return out;
  }, [artifacts, ask]);

  const onExpand = renderArtifactPopover && walkable.length > 0
    ? (entryId: string) => (anchor: HTMLElement | null) => setExpanded({ entryId, anchor })
    : undefined;

  const popover = expanded && renderArtifactPopover
    ? renderArtifactPopover({
        entries: walkable,
        activeEntryId: expanded.entryId,
        onActiveEntryChange: (entryId) =>
          setExpanded((current) => (current ? { ...current, entryId } : current)),
        onDismiss: () => setExpanded(null),
        anchor: expanded.anchor,
      })
    : null;

  switch (ask.type) {
    case 'singleSelect':
      if (showCards) {
        return (
          <ComposeArtifactGrid>
            {ask.options.map((option) => {
              const artifact = artifactFor(artifacts, option.id);
              return (
                <ComposeArtifactCard
                  key={option.id}
                  label={option.label}
                  description={option.description}
                  preview={artifact
                    ? renderArtifact!({ id: option.id, label: option.label }, artifact)
                    : null}
                  onExpand={artifact ? onExpand?.(option.id) : undefined}
                />
              );
            })}
            {popover}
          </ComposeArtifactGrid>
        );
      }
      return (
        <WidgetOptionList>
          {ask.options.map((option) => (
            <WidgetOptionRow
              key={option.id}
              label={option.label}
              description={option.description}
              selected={false}
            />
          ))}
          {ask.allowOther && <WidgetOptionRow label="Other" selected={false} />}
        </WidgetOptionList>
      );

    case 'multiSelect':
      return (
        <WidgetOptionList>
          {ask.items.map((item) => (
            <WidgetOptionRow
              key={item.id}
              label={item.title}
              description={item.subtitle}
              selected={false}
            />
          ))}
        </WidgetOptionList>
      );

    case 'reorder':
      if (showCards) {
        return (
          <ComposeArtifactGrid>
            {ask.items.map((item) => {
              const artifact = artifactFor(artifacts, item.id);
              return (
                <ComposeArtifactCard
                  key={item.id}
                  label={item.title}
                  description={item.subtitle}
                  preview={artifact
                    ? renderArtifact!({ id: item.id, label: item.title }, artifact)
                    : null}
                  onExpand={artifact ? onExpand?.(item.id) : undefined}
                />
              );
            })}
            {popover}
          </ComposeArtifactGrid>
        );
      }
      return (
        <div className="feedback-compose-reorder-preview flex flex-col gap-1.5">
          {ask.items.map((item, index) => (
            <div
              key={item.id}
              className="flex items-center gap-2.5 rounded border border-nim bg-nim-secondary px-2.5 py-2"
            >
              <svg width="12" height="12" viewBox="0 0 14 14" className="text-nim-faint shrink-0">
                <circle cx="5" cy="3" r="1" fill="currentColor" />
                <circle cx="9" cy="3" r="1" fill="currentColor" />
                <circle cx="5" cy="7" r="1" fill="currentColor" />
                <circle cx="9" cy="7" r="1" fill="currentColor" />
                <circle cx="5" cy="11" r="1" fill="currentColor" />
                <circle cx="9" cy="11" r="1" fill="currentColor" />
              </svg>
              <span className="font-mono text-[0.6875rem] font-semibold text-nim-muted w-4 text-center shrink-0">
                {index + 1}
              </span>
              <span className="flex flex-col min-w-0">
                <span className="text-[0.8125rem] font-medium text-nim leading-snug">{item.title}</span>
                {item.subtitle && (
                  <span className="text-xs text-nim-muted leading-snug">{item.subtitle}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      );

    case 'editText':
      return <StaticField>{ask.placeholder || ask.initialText || 'Optional…'}</StaticField>;

    case 'confirm':
      return (
        <WidgetOptionList>
          <WidgetOptionRow label="Yes" selected={ask.defaultValue === true} />
          <WidgetOptionRow label="No" selected={ask.defaultValue === false} />
        </WidgetOptionList>
      );

    case 'rating':
      return (
        <StaticField>
          {ask.minLabel ? `${ask.minLabel} · ` : ''}
          {ask.min} to {ask.max}
          {ask.maxLabel ? ` · ${ask.maxLabel}` : ''}
        </StaticField>
      );
  }
};
