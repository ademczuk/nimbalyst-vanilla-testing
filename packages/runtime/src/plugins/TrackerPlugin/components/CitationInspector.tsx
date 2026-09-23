/**
 * Citation inspector (knowledge-scopes contract 4.4, N7).
 *
 * Answers four questions about one citation, in this order, because that is the
 * order in which a reader stops trusting it:
 *
 * 1. **What does it assert?** The relation (supports / challenges / context),
 *    the explanation, and the excerpt.
 * 2. **Where exactly?** The locator, rendered property by property rather than
 *    as a summary string. A locator a reader cannot see is a locator nobody
 *    checks.
 * 3. **From which retrieval?** The capture: when, what answered, what outcome,
 *    what digest. A citation with no capture is an assertion about a document
 *    nobody recorded reading.
 * 4. **Against which revision?** The pinned revision of the cited item, read
 *    through the host's exact-revision read.
 *
 * The load-bearing behavior is in (2) and (4). A locator that fails validation
 * is shown AS invalid with its error codes, never silently omitted, because a
 * citation whose address is malformed looks exactly like one with no address.
 * And a pinned revision that cannot be read renders as an explicit failure
 * rather than falling back to the item as it is today: showing newer evidence
 * under a pin is the one outcome contract 4.2 exists to prevent, and nothing in
 * a silently-substituted render would say the evidence moved.
 */

import React, { useEffect, useState } from 'react';
import {
  describeCitationLocator,
  validateCitationLocator,
  type CitationFieldValue,
  type CitationRelation,
} from '@nimbalyst/tracker-schema';
import { MaterialSymbol } from '../../../ui/icons/MaterialSymbol';
import { formatDateTimeDisplay } from './TrackerFieldEditor';

/** A tracker item as the inspector needs it, with no dependency on the host's item type. */
export interface CitationInspectorItem {
  itemId: string;
  type?: string;
  issueKey?: string;
  title?: string;
  /** Flattened field bag: schema fields and custom fields together. */
  fields: Record<string, unknown>;
}

/** How a caller names the revision it wants. Mirrors `TrackerRevisionRef`. */
export interface CitationRevisionRef {
  revisionId?: string;
  serverRevision?: number;
}

export interface CitationPinnedRevision {
  revisionId: string;
  serverRevision: number | null;
  deletedAt: number | null;
  recordedAt: number;
  data: Record<string, unknown>;
}

/**
 * Everything the inspector needs from its host, injected rather than imported:
 * this component lives in `runtime`, and the data source that backs it lives in
 * `collab-client`, which depends on `runtime` and not the other way round.
 */
export interface CitationInspectorHost {
  /** Resolve an already-loaded item (the citation, its capture, its source). */
  lookupItem(itemId: string): CitationInspectorItem | null;
  /**
   * Read one exact revision. MUST reject when the revision is missing or the
   * host keeps no revision log; it must never answer with the live item.
   * Absent when the host has no revision read at all.
   */
  readRevision?(itemId: string, ref: CitationRevisionRef): Promise<CitationPinnedRevision>;
}

export interface CitationInspectorProps {
  entry: CitationFieldValue;
  host: CitationInspectorHost;
  /** Open the citation item itself, for editing. */
  onOpenItem?: (itemId: string) => void;
}

const RELATION_META: Record<CitationRelation, { label: string; icon: string; className: string }> = {
  supports: { label: 'Supports', icon: 'thumb_up', className: 'citation-relation-supports' },
  challenges: { label: 'Challenges', icon: 'thumb_down', className: 'citation-relation-challenges' },
  context: { label: 'Context', icon: 'info', className: 'citation-relation-context' },
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * A relationship value as stored, which is what `claim` and `capture` hold.
 * Single-valued fields store the object; readers must tolerate an array
 * because the same storage helpers serve multi-valued fields.
 */
function firstRelationship(value: unknown): {
  itemId?: string;
  title?: string;
  issueKey?: string;
  revisionId?: string;
  serverRevision?: number;
} | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== 'object') return null;
  return candidate as Record<string, never>;
}

type RevisionState =
  | { kind: 'unpinned' }
  | { kind: 'no-reader' }
  | { kind: 'loading' }
  | { kind: 'loaded'; revision: CitationPinnedRevision }
  | { kind: 'failed'; message: string };

/**
 * Resolve the revision the citation pins on the item it cites.
 *
 * There is deliberately no fallback branch here. Every terminal state either
 * names the exact revision or says why it could not be shown.
 */
function usePinnedRevision(
  host: CitationInspectorHost,
  citedItemId: string | undefined,
  ref: CitationRevisionRef | null,
): RevisionState {
  const [state, setState] = useState<RevisionState>({ kind: 'unpinned' });
  const revisionId = ref?.revisionId;
  const serverRevision = ref?.serverRevision;
  const readRevision = host.readRevision;

  useEffect(() => {
    if (!citedItemId || (revisionId === undefined && serverRevision === undefined)) {
      setState({ kind: 'unpinned' });
      return;
    }
    if (!readRevision) {
      setState({ kind: 'no-reader' });
      return;
    }
    let cancelled = false;
    setState({ kind: 'loading' });
    readRevision(citedItemId, revisionId !== undefined ? { revisionId } : { serverRevision })
      .then((revision) => {
        if (!cancelled) setState({ kind: 'loaded', revision });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          kind: 'failed',
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [citedItemId, revisionId, serverRevision, readRevision]);

  return state;
}

const SectionHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="citation-inspector-heading text-[11px] font-medium uppercase tracking-[0.5px] text-[var(--nim-text-muted)]">
    {children}
  </div>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="citation-inspector-row flex gap-2 text-[12px] leading-5">
    <span className="min-w-[96px] shrink-0 text-[var(--nim-text-muted)]">{label}</span>
    <span className="min-w-0 break-words text-[var(--nim-text)] select-text">{children}</span>
  </div>
);

export const CitationInspector: React.FC<CitationInspectorProps> = ({ entry, host, onOpenItem }) => {
  const citation = host.lookupItem(entry.itemId);
  const fields = citation?.fields ?? {};

  const relation = (asString(fields.relation) ?? entry.relation ?? 'supports') as CitationRelation;
  const relationMeta = RELATION_META[relation] ?? RELATION_META.supports;

  const claim = firstRelationship(fields.claim);
  const capture = firstRelationship(fields.capture);
  const captureItem = capture?.itemId ? host.lookupItem(capture.itemId) : null;
  const captureFields = captureItem?.fields ?? {};
  const source = firstRelationship(captureFields.source);

  const locatorResult = validateCitationLocator(fields.locator);
  const revisionState = usePinnedRevision(
    host,
    claim?.itemId,
    claim && (claim.revisionId !== undefined || claim.serverRevision !== undefined)
      ? { revisionId: claim.revisionId, serverRevision: claim.serverRevision }
      : null,
  );

  const title = citation?.title ?? entry.title ?? entry.itemId;

  return (
    <div className="citation-inspector flex w-[380px] max-w-full flex-col gap-3 p-3" data-testid="citation-inspector">
      <div className="citation-inspector-header flex items-start gap-2">
        <span
          className={`citation-inspector-relation ${relationMeta.className} flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--nim-text-muted)]`}
        >
          <MaterialSymbol icon={relationMeta.icon} size={14} />
          {relationMeta.label}
        </span>
        <button
          type="button"
          className="citation-inspector-title min-w-0 flex-1 text-left text-[13px] font-medium text-[var(--nim-text)] hover:underline"
          onClick={onOpenItem ? () => onOpenItem(entry.itemId) : undefined}
          disabled={!onOpenItem}
        >
          {title}
        </button>
      </div>

      {!citation && (
        <div className="citation-inspector-missing text-[12px] text-[var(--nim-text-muted)] select-text">
          This citation item is not loaded here, so only the stored reference is shown.
        </div>
      )}

      {asString(fields.explanation) && (
        <div className="citation-inspector-explanation text-[12px] leading-5 text-[var(--nim-text)] select-text">
          {asString(fields.explanation)}
        </div>
      )}

      {asString(fields.excerpt) && (
        <blockquote className="citation-inspector-excerpt border-l-2 border-[var(--nim-border)] pl-2 text-[12px] italic leading-5 text-[var(--nim-text-muted)] select-text">
          {asString(fields.excerpt)}
        </blockquote>
      )}

      <div className="citation-inspector-locator flex flex-col gap-1">
        <SectionHeading>Locator</SectionHeading>
        {fields.locator === undefined || fields.locator === null ? (
          <div className="citation-inspector-locator-absent text-[12px] text-[var(--nim-text-muted)] select-text">
            No locator. This citation names a document, not a passage in it.
          </div>
        ) : locatorResult.valid ? (
          <>
            <Row label="Selector">{locatorResult.locator.selectorType}</Row>
            <Row label="Address">{describeCitationLocator(locatorResult.locator)}</Row>
            {Object.entries(locatorResult.locator as unknown as Record<string, unknown>)
              .filter(([key]) => key !== 'selectorType' && key !== 'version')
              .map(([key, value]) => (
                <Row key={key} label={key}>{String(value)}</Row>
              ))}
          </>
        ) : (
          // Shown, not hidden: an invalid locator and an absent one look
          // identical to a reader otherwise, and only one of them is a bug.
          <div className="citation-inspector-locator-invalid text-[12px] text-[var(--nim-danger,#dc2626)] select-text">
            <div>This locator does not validate against contract 4.4.</div>
            <ul className="mt-1 list-disc pl-4">
              {locatorResult.issues.map((locatorIssue, index) => (
                <li key={`${locatorIssue.code}-${index}`}>
                  <code>{locatorIssue.code}</code>
                  {locatorIssue.path ? ` at ${locatorIssue.path}` : ''}: {locatorIssue.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="citation-inspector-capture flex flex-col gap-1">
        <SectionHeading>Capture</SectionHeading>
        {!capture?.itemId ? (
          <div className="citation-inspector-capture-absent text-[12px] text-[var(--nim-text-muted)] select-text">
            No capture. Nothing records when this passage was actually read.
          </div>
        ) : (
          <>
            <Row label="Capture">{captureItem?.title ?? capture.title ?? capture.itemId}</Row>
            {asString(captureFields.capturedAt) && (
              <Row label="Captured">{formatDateTimeDisplay(captureFields.capturedAt).display}</Row>
            )}
            {asString(captureFields.outcome) && <Row label="Outcome">{asString(captureFields.outcome)}</Row>}
            {source && <Row label="Source">{source.title ?? source.itemId ?? ''}</Row>}
            {asString(captureFields.digest) && <Row label="Digest">{asString(captureFields.digest)}</Row>}
          </>
        )}
      </div>

      <div className="citation-inspector-revision flex flex-col gap-1">
        <SectionHeading>Pinned revision</SectionHeading>
        {revisionState.kind === 'unpinned' && (
          <div className="citation-inspector-revision-unpinned text-[12px] text-[var(--nim-text-muted)] select-text">
            Not pinned. This citation follows the cited item as it changes.
          </div>
        )}
        {revisionState.kind === 'no-reader' && (
          <div className="citation-inspector-revision-unsupported text-[12px] text-[var(--nim-text-muted)] select-text">
            This host keeps no revision log, so the pinned revision cannot be shown here.
          </div>
        )}
        {revisionState.kind === 'loading' && (
          <div className="citation-inspector-revision-loading text-[12px] text-[var(--nim-text-muted)]">
            Reading revision...
          </div>
        )}
        {revisionState.kind === 'failed' && (
          <div className="citation-inspector-revision-failed text-[12px] text-[var(--nim-danger,#dc2626)] select-text">
            {revisionState.message}
          </div>
        )}
        {revisionState.kind === 'loaded' && (
          <>
            <Row label="Revision">
              <code>{revisionState.revision.revisionId}</code>
            </Row>
            <Row label="Server no.">
              {revisionState.revision.serverRevision === null
                ? 'not synced'
                : String(revisionState.revision.serverRevision)}
            </Row>
            <Row label="Recorded">{formatDateTimeDisplay(revisionState.revision.recordedAt).display}</Row>
            {revisionState.revision.deletedAt !== null && revisionState.revision.deletedAt !== undefined && (
              <Row label="Deleted">{formatDateTimeDisplay(revisionState.revision.deletedAt).display}</Row>
            )}
            {asString(revisionState.revision.data.title) && (
              <Row label="Title then">{asString(revisionState.revision.data.title)}</Row>
            )}
          </>
        )}
      </div>
    </div>
  );
};
