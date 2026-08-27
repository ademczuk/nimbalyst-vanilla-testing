/**
 * Screen inventory over time: which revision a card shows, and who made it.
 *
 * Two facts make this cheap, and both are older than this module. A canvas card
 * is a *reference*, not a copy -- so pinning one to a past revision is a change
 * to a string on a node, not a copy of any content. And `CanvasDocumentTarget`
 * has carried an optional `revisionId` since Slice 1, so the format already says
 * "this card is the login screen as of revision 7" without a second mechanism.
 *
 * Everything here is a pure function over data the host hands in. The canvas
 * cannot list revisions itself -- that is an authenticated request against the
 * document's room -- and it must not learn how, for the same reason it does not
 * know how to resolve an extension: `./canvas` ships to the web console, where
 * the transport is a different object. The host fills `canvasCallbacks.revisions`
 * and this module decides what the answers *mean*.
 *
 * **There is deliberately no restore in this slice.** Pinning a revision adds a
 * new card that points at it; nothing here writes a revision back over live
 * content, and no function in this file returns a document with an existing
 * node's target rewritten. That is not an oversight to be filled in later by
 * whoever needs it -- restore-over-head is a destructive path
 * (`.claude/rules/destructive-data-paths.md`) and it needs the retry, the
 * verification, and the recoverable artifact that rule requires. Pin-as-a-new-
 * card is the safe primitive that makes the destructive one unnecessary for the
 * thing people actually want, which is comparing v3 against v7 side by side.
 */

import {
  NIMBALYST_CANVAS_NAMESPACE,
  toCanvasCoordinate,
  type CanvasAnyNode,
  type CanvasDocument,
} from './CanvasDocument';
import {
  canvasCardLabel,
  canvasCardReference,
  createCanvasId,
} from './canvasFlowMapping';
import type { CanvasCardReference } from './canvasCallbacks';

/** Gap between a source card and the revision card pinned beside it. */
const PINNED_CARD_GUTTER = 24;

/** How far right to look for clear space before giving up and overlapping. */
const MAX_PLACEMENT_STEPS = 8;

/**
 * A revision, as the document's room reports it.
 *
 * Structurally a subset of `DocRevisionMetadata` from `@nimbalyst/collab-protocol`,
 * restated rather than imported: this module is bundled for two hosts and has no
 * other reason to depend on the protocol package, and a narrower input is also a
 * narrower contract for a host that gets its history from somewhere else.
 */
export interface CanvasRevisionRecord {
  revisionId: string;
  /** Server clock at create time, ms since epoch. */
  createdAt: number;
  /** Room-authed user id of whoever captured it. */
  createdBy: string;
  revisionKind?: string;
  editorType?: string;
}

/**
 * A session's edit of this card's content, as the host observed it locally.
 *
 * On the desktop this is a `session_files` row (`link_type = 'edited'`) joined
 * to `ai_sessions` for the name; `prompt` is that session's driving prompt. A
 * host with no local session store supplies none, and every revision then
 * carries author-only provenance -- which is honest, and is what the browser
 * console shows.
 */
export interface CanvasRevisionSessionEdit {
  sessionId: string;
  sessionName: string | null;
  /** When the session touched the content, ms since epoch. */
  editedAt: number;
  /** The prompt that drove the session, when the host can name one. */
  prompt: string | null;
}

export interface CanvasRevisionCommit {
  sha: string;
  subject: string | null;
  /** The session credited with the commit (`session_commits.session_id`). */
  sessionId: string;
  committedAt: number;
}

export interface CanvasRevisionFacts {
  /** User id -> display name, for the revision author. */
  displayNames?: ReadonlyMap<string, string>;
  /** Session edits of this card's content, in any order. */
  edits?: readonly CanvasRevisionSessionEdit[];
  /** Commits attributed to sessions, in any order. */
  commits?: readonly CanvasRevisionCommit[];
}

export interface CanvasRevisionProvenance {
  /** Who the room says captured the revision. Always present. */
  authorUserId: string;
  /** Resolved display name, or null when the roster does not know them. */
  authorName: string | null;
  /** The session credited with the content, or null when none can be. */
  sessionId: string | null;
  sessionName: string | null;
  /** The prompt that drove that session, or null. */
  prompt: string | null;
  /** The commit that shipped this revision, or null if it has not shipped. */
  commit: CanvasRevisionCommit | null;
}

export interface CanvasRevisionEntry {
  revisionId: string;
  createdAt: number;
  /** 1-based, oldest first: the "v7" a person says out loud. */
  sequence: number;
  revisionKind: string | null;
  editorType: string | null;
  provenance: CanvasRevisionProvenance;
}

/**
 * The host's answer to "what revisions does this card's content have?"
 *
 * Optional on `canvasCallbacks`: a host without one shows no rail at all rather
 * than an empty one, because "this document has no history" and "this host
 * cannot ask" are different claims and only one of them is ours to make.
 */
export interface CanvasRevisionSource {
  /**
   * Newest first. Rejecting is allowed and is treated as "unavailable"; an
   * empty array means the document genuinely has no revisions yet.
   */
  list(reference: CanvasCardReference): Promise<readonly CanvasRevisionEntry[]>;
}

export interface CanvasCardRevisionTarget {
  /** The revision this card must show, or null to follow the document head. */
  revisionId: string | null;
  /**
   * True when the card names a revision. A pinned card is history: the host
   * must mount it read-only, and the surface must not offer to activate it.
   */
  pinned: boolean;
}

const HEAD: CanvasCardRevisionTarget = { revisionId: null, pinned: false };

/**
 * Which revision a card reference resolves to.
 *
 * The single place that answers it, because there are two shapes that can carry
 * a pin and they must not drift apart:
 *
 * - a `doc` card names the revision on the reference itself;
 * - a `file` card names it on `sharedAs`, the binding a local file grows when
 *   the board is shared. The pin lives with the shared identity because that is
 *   the only identity a revision exists against -- a private file on one laptop
 *   has no revision history to point at, so a `file` card with no `sharedAs`
 *   follows the bytes on disk and that is the whole answer.
 *
 * An absent, empty, or non-string `revisionId` is head. The field arrives from
 * a Y.Map or from JSON some other tool wrote, so "absent" is not the only way
 * for it to be missing.
 */
export function resolveCanvasCardRevision(
  reference: CanvasCardReference | null | undefined
): CanvasCardRevisionTarget {
  if (!reference) return HEAD;
  const raw =
    reference.kind === 'doc'
      ? reference.revisionId
      : reference.sharedAs?.revisionId;
  if (typeof raw !== 'string' || raw === '') return HEAD;
  return { revisionId: raw, pinned: true };
}

/**
 * The reference a card should actually mount.
 *
 * A `file` card that has been shared has two truthful identities -- the path on
 * this machine and the document in the room -- and `preferShared` is the host's
 * standing preference between them. A **pin overrides that preference**, and
 * this is the subtle part: a revision exists only against the shared document,
 * so mounting the local path for a pinned card would silently show head. The
 * card would look right, carry a "v3" label, and be the wrong content -- the
 * exact failure this whole slice is supposed to make impossible.
 */
export function effectiveCanvasCardReference(
  reference: CanvasCardReference | null | undefined,
  options: { preferShared?: boolean } = {}
): CanvasCardReference | null {
  if (!reference) return null;
  if (reference.kind === 'doc') return reference;
  const shared = reference.sharedAs;
  if (!shared) return reference;
  const mustUseShared =
    options.preferShared === true ||
    resolveCanvasCardRevision(reference).pinned;
  return mustUseShared ? { kind: 'doc', ...shared } : reference;
}

/** The shared-document URI a card's revisions would be listed against, if any. */
export function canvasCardDocumentUri(
  reference: CanvasCardReference | null | undefined
): string | null {
  if (!reference) return null;
  if (reference.kind === 'doc') return reference.uri;
  return reference.sharedAs?.uri ?? null;
}

/**
 * Join room-reported revisions to locally-known sessions and commits.
 *
 * The interesting rule is attribution, and it is a *window*, not a nearest
 * match. A revision is a snapshot of everything that happened since the
 * previous one, so the session credited with revision N is the last one that
 * edited the content strictly after revision N-1 was captured and at or before
 * N was. An edit older than the previous revision already belongs to that
 * revision; crediting it again would put the same session's name on every
 * revision after it forever, which is the failure mode a nearest-timestamp
 * match walks straight into.
 *
 * Anything outside the window attributes to nothing. A revision a person saved
 * by hand, in a document no session has touched, honestly carries only its
 * author -- inventing a session for it would make the whole rail untrustworthy
 * for the case it exists to serve.
 *
 * The commit is likewise the *first* one the attributed session landed at or
 * after the snapshot: the commit that shipped this content. Later commits by
 * the same long-running session shipped something else.
 *
 * `revisions` may arrive in any order; the result is newest first, and
 * `sequence` counts from the oldest.
 */
export function assembleCanvasRevisions(
  revisions: readonly CanvasRevisionRecord[],
  facts: CanvasRevisionFacts = {}
): CanvasRevisionEntry[] {
  const oldestFirst = [...revisions].sort(
    (left, right) => left.createdAt - right.createdAt
  );
  const edits = [...(facts.edits ?? [])].sort(
    (left, right) => left.editedAt - right.editedAt
  );
  const commits = [...(facts.commits ?? [])].sort(
    (left, right) => left.committedAt - right.committedAt
  );

  return oldestFirst
    .map((revision, index) => {
      const previousAt = index > 0 ? oldestFirst[index - 1].createdAt : null;
      const edit = lastEditIn(edits, previousAt, revision.createdAt);
      return {
        revisionId: revision.revisionId,
        createdAt: revision.createdAt,
        sequence: index + 1,
        revisionKind: revision.revisionKind ?? null,
        editorType: revision.editorType ?? null,
        provenance: {
          authorUserId: revision.createdBy,
          authorName: facts.displayNames?.get(revision.createdBy) ?? null,
          sessionId: edit?.sessionId ?? null,
          sessionName: edit?.sessionName ?? null,
          prompt: edit?.prompt ?? null,
          commit:
            edit === null
              ? null
              : firstCommitAtOrAfter(commits, edit.sessionId, revision.createdAt),
        },
      };
    })
    .reverse();
}

function lastEditIn(
  ascendingEdits: readonly CanvasRevisionSessionEdit[],
  afterExclusive: number | null,
  atOrBefore: number
): CanvasRevisionSessionEdit | null {
  let found: CanvasRevisionSessionEdit | null = null;
  for (const edit of ascendingEdits) {
    if (edit.editedAt > atOrBefore) break;
    if (afterExclusive !== null && edit.editedAt <= afterExclusive) continue;
    found = edit;
  }
  return found;
}

function firstCommitAtOrAfter(
  ascendingCommits: readonly CanvasRevisionCommit[],
  sessionId: string,
  atOrAfter: number
): CanvasRevisionCommit | null {
  return (
    ascendingCommits.find(
      (commit) =>
        commit.sessionId === sessionId && commit.committedAt >= atOrAfter
    ) ?? null
  );
}

export interface PinCanvasRevisionInput {
  /** The card whose history is open. */
  sourceNodeId: string;
  revisionId: string;
  /** The rail's "v7"; used for the pinned card's label. */
  sequence?: number;
}

/**
 * Add a card showing one revision, beside the card it came from.
 *
 * Additive by construction: the source node is returned untouched, and the new
 * node is a `doc` reference carrying `revisionId`, so the pinned card resolves
 * through exactly the path a head card does -- one string different. Nothing
 * about it is a copy of the revision's content, which is why this stays a pure
 * document edit and needs no snapshot bytes at all.
 *
 * Returns the document unchanged when the source card has no shared identity to
 * pin against: a private `file` card has no revisions, and minting a `doc` node
 * pointing at a document that does not exist would give the user a permanently
 * broken card in exchange for a click.
 */
export function pinCanvasRevisionCard(
  document: CanvasDocument,
  input: PinCanvasRevisionInput
): CanvasDocument {
  const nodes = document.nodes ?? [];
  const source = nodes.find((node) => node.id === input.sourceNodeId);
  if (!source) return document;

  const uri = canvasCardDocumentUri(canvasCardReference(source));
  if (uri === null || input.revisionId === '') return document;

  const width = numberOr(source.width, 400);
  const height = numberOr(source.height, 300);
  const sourceLabel = canvasCardLabel(source) || uri;
  const placement = clearPlacement(nodes, {
    x: numberOr(source.x, 0),
    y: numberOr(source.y, 0),
    width,
    height,
  });

  const pinned = {
    id: createCanvasId(
      'revision',
      new Set(nodes.map((node) => node.id))
    ),
    // `link` with the document URI, so a plain JSON Canvas reader still shows
    // something true rather than a node type it has to skip.
    type: 'link',
    url: uri,
    x: placement.x,
    y: placement.y,
    width,
    height,
    [NIMBALYST_CANVAS_NAMESPACE]: {
      label:
        input.sequence === undefined
          ? sourceLabel
          : `${sourceLabel} v${input.sequence}`,
      reference: {
        kind: 'doc' as const,
        uri,
        revisionId: input.revisionId,
      },
    },
  } as CanvasAnyNode;

  return { ...document, nodes: [...nodes, pinned] };
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The first free slot to the right of the source, else the last one tried.
 *
 * Dropping the pinned card exactly on top of the neighbour would defeat the
 * point of the gesture -- the whole reason to pin a revision is to see it next
 * to something -- so this walks right until it finds space. It gives up rather
 * than searching forever; an overlap the user can drag out of beats a click
 * that appears to do nothing.
 */
function clearPlacement(nodes: readonly CanvasAnyNode[], source: Rect): Rect {
  const others = nodes.map((node) => ({
    x: numberOr(node.x, 0),
    y: numberOr(node.y, 0),
    width: numberOr(node.width, 0),
    height: numberOr(node.height, 0),
  }));
  const step = source.width + PINNED_CARD_GUTTER;
  let candidate: Rect = { ...source, x: source.x + step };
  for (let attempt = 0; attempt < MAX_PLACEMENT_STEPS; attempt += 1) {
    if (!others.some((other) => overlaps(candidate, other))) break;
    candidate = { ...candidate, x: candidate.x + step };
  }
  return {
    ...candidate,
    x: toCanvasCoordinate(candidate.x),
    y: toCanvasCoordinate(candidate.y),
  };
}

function overlaps(left: Rect, right: Rect): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback;
}
