/**
 * The local client's half of CSV presence: which cell is selected, and which
 * cell this client currently has a *cell editor open on*.
 *
 * It exists because those two facts are published on one awareness state and
 * were written by two independent event paths. Selection publishes hardcoded
 * `editingCell: null` ("selecting a cell is not editing it"), which is true
 * only when no editor is open -- and RevoGrid emits focus/range events *while*
 * an editor is open. A selection event landing 56ms after `beforeeditstart`
 * therefore retracted the editing flag, and because DocumentSync coalesces
 * awareness to ~2Hz, the `editingCell` frame in between never reached the wire
 * at all: peers saw a selection box with no "editing" state and no name label,
 * permanently, because the presence heartbeat then re-affirmed it every 5s.
 *
 * So editing state gets exactly one writer -- this tracker -- and selection
 * publishes carry whatever it currently holds rather than asserting null.
 *
 * Free of Yjs and DOM, like `presence.ts`, so the ordering rules are unit
 * testable without a grid.
 */

/** A cell coordinate in the editor's logical space. */
export interface PresenceCell {
  row: number;
  col: number;
}

/** An awareness patch for `CsvBinding.setLocalAwareness`; omitted keys are untouched. */
export interface LocalPresencePatch {
  selectedCell?: PresenceCell | null;
  editingCell?: PresenceCell | null;
}

/**
 * Identifies one open-editor lifetime. A cell editor can disconnect *after*
 * the next one has already opened (moving straight from one cell's editor to
 * another), and a late `disconnectedCallback` from the outgoing editor must
 * not clear the incoming editor's flag.
 */
export type EditSession = number;

export class LocalPresenceTracker {
  private editing: PresenceCell | null = null;
  private session: EditSession = 0;

  /** The session an editor instance should hand back when it disconnects. */
  currentSession(): EditSession {
    return this.session;
  }

  /** True while a cell editor is open on this client. */
  isEditing(): boolean {
    return this.editing !== null;
  }

  /**
   * The selection moved. The patch restates the editing cell rather than
   * clearing it, so a focus event that arrives mid-edit cannot retract it.
   */
  select(cell: PresenceCell | null): LocalPresencePatch {
    return { selectedCell: cell, editingCell: this.editing };
  }

  /** A cell editor opened on `cell`. */
  beginEdit(cell: PresenceCell | null): { patch: LocalPresencePatch; session: EditSession } {
    this.session += 1;
    this.editing = cell;
    return { patch: { editingCell: cell }, session: this.session };
  }

  /**
   * The editor closed -- committed, cancelled with Escape, or unmounted.
   *
   * Pass the session an editor instance captured when it opened; a mismatch
   * means a newer editor owns the flag and this close is stale. Returns null
   * when there is nothing to publish, so a redundant clear stays off the wire.
   */
  endEdit(session?: EditSession): LocalPresencePatch | null {
    if (session !== undefined && session !== this.session) return null;
    if (this.editing === null) return null;
    this.editing = null;
    return { editingCell: null };
  }
}
