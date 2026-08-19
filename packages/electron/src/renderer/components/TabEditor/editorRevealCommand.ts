/**
 * Routes "scroll to this line" requests to whichever editor is mounted for a
 * file. Line links (a transcript reference like `/abs/path.md:653`, or a Quick
 * Open grep hit) usually target a file that has no tab yet, so the request
 * almost always arrives before there is an editor to service it.
 *
 * A request with no handler is therefore held as *pending* and replayed when a
 * handler registers. TabEditor registers only once its editor is mounted and
 * has content (gated on `isEditorReady`), for the same reason the DocumentModel
 * callbacks are -- an immediate-fire subscriber that runs against a null editor
 * does nothing visible and swallows the request.
 *
 * Pending requests expire. Without that, an open that fails leaves a request
 * armed against the next mount of that path, producing a scroll the user never
 * asked for.
 */

export interface EditorRevealPosition {
  /** 1-based line in the file's on-disk text. */
  line: number;
  /** 1-based column. Honored by Monaco; the rich markdown view is block-granular. */
  column?: number;
}

type EditorRevealHandler = (position: EditorRevealPosition) => void;

/** How long an unclaimed reveal stays armed. Long enough to cover reading a large file off disk. */
export const PENDING_REVEAL_TTL_MS = 10_000;

interface PendingReveal {
  position: EditorRevealPosition;
  timer: ReturnType<typeof setTimeout>;
}

const handlersByFilePath = new Map<string, EditorRevealHandler>();
const pendingByFilePath = new Map<string, PendingReveal>();

function dropPending(filePath: string): void {
  const pending = pendingByFilePath.get(filePath);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingByFilePath.delete(filePath);
}

/**
 * Reveal a position in the editor for `filePath`. Returns true if an editor
 * handled it now, false if it was held for the editor that is still mounting.
 */
export function revealEditorPosition(filePath: string, position: EditorRevealPosition): boolean {
  // A newer request always wins: the user clicked a second link before the
  // first tab finished opening, and they want the second one.
  dropPending(filePath);

  const handler = handlersByFilePath.get(filePath);
  if (handler) {
    handler(position);
    return true;
  }

  pendingByFilePath.set(filePath, {
    position,
    timer: setTimeout(() => pendingByFilePath.delete(filePath), PENDING_REVEAL_TTL_MS),
  });
  return false;
}

/** Register the reveal handler for a file, draining any pending request. Returns an unregister function. */
export function registerEditorRevealHandler(
  filePath: string,
  handler: EditorRevealHandler,
): () => void {
  handlersByFilePath.set(filePath, handler);

  const pending = pendingByFilePath.get(filePath);
  if (pending) {
    dropPending(filePath);
    handler(pending.position);
  }

  return () => {
    if (handlersByFilePath.get(filePath) === handler) {
      handlersByFilePath.delete(filePath);
    }
  };
}

/** Test seam: drop every handler and armed request so one test's state can't leak into the next. */
export function resetEditorRevealCommand(): void {
  for (const filePath of [...pendingByFilePath.keys()]) {
    dropPending(filePath);
  }
  handlersByFilePath.clear();
}

/** An editor wrapper that can reveal a position itself (the Monaco wrapper). */
export interface EditorWithReveal {
  revealPosition: (line: number, column?: number) => void;
}

export function hasEditorReveal(editor: unknown): editor is EditorWithReveal {
  return typeof (editor as Partial<EditorWithReveal> | null | undefined)?.revealPosition === 'function';
}
