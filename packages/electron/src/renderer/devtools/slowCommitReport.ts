/**
 * Names the components behind one slow React commit, from the committed fiber
 * tree. Pure: it reads fibers and returns data, so a test can hand it a tree.
 *
 * Needs the dev build's profiling timers (`actualDuration`). Production React
 * does not record them, so production jank logs carry only the frame's script
 * attribution from `rendererJankMonitor.ts`.
 */

type Fiber = any;

const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);
const PERFORMED_WORK = 0b1;
const MAX_NODES = 100_000;
const MAX_ANCESTOR_HOPS = 200;

export interface SlowComponent {
  name: string;
  /** Render time excluding children, summed over every instance. */
  selfMs: number;
  instances: number;
  /** The tab or document it belongs to, when an ancestor names one. */
  context: string | null;
  /** First DOM class under it, which identifies minified extension components. */
  element: string | null;
  /** False when the component's DOM is not displayed (a hidden tab). */
  visible: boolean | null;
}

export interface SlowCommitSummary {
  totalMs: number;
  top: SlowComponent[];
}

function nameOf(fiber: Fiber): string {
  const t = fiber.type;
  if (!t) return '';
  return t.displayName || t.name || t.render?.displayName || t.render?.name || t.type?.displayName || t.type?.name || '(anonymous)';
}

function contextOf(fiber: Fiber): string | null {
  let node = fiber.return;
  for (let hops = 0; node && hops < MAX_ANCESTOR_HOPS; hops++, node = node.return) {
    const props = node.memoizedProps;
    if (props && typeof props === 'object') {
      const label = props.filePath ?? props.fileName ?? props.sessionId;
      if (typeof label === 'string' && label) return label;
    }
  }
  return null;
}

function firstElement(fiber: Fiber): Element | null {
  let node = fiber.child;
  for (let hops = 0; node && hops < MAX_ANCESTOR_HOPS; hops++, node = node.child) {
    if (typeof Element !== 'undefined' && node.stateNode instanceof Element) return node.stateNode;
  }
  return null;
}

function isDisplayed(el: Element | null): boolean | null {
  if (!el) return null;
  const check = (el as any).checkVisibility;
  if (typeof check === 'function') return check.call(el);
  return (el as HTMLElement).offsetParent !== null;
}

/**
 * @param commitFloor timestamp of this root's previous commit; fibers whose
 *   `actualStartTime` predates it are left over from an earlier commit.
 */
export function summarizeSlowCommit(rootFiber: Fiber, commitFloor: number, limit = 5): SlowCommitSummary {
  const byName = new Map<string, { selfMs: number; instances: number; heaviest: Fiber; heaviestMs: number }>();
  const stack: Fiber[] = [rootFiber];
  let visited = 0;
  while (stack.length && visited < MAX_NODES) {
    const fiber = stack.pop()!;
    visited++;
    const start = fiber.actualStartTime;
    const rendered =
      COMPONENT_TAGS.has(fiber.tag) &&
      (fiber.flags & PERFORMED_WORK) !== 0 &&
      (typeof start !== 'number' || start <= 0 || start > commitFloor);
    if (rendered) {
      let self = fiber.actualDuration ?? 0;
      for (let c = fiber.child; c; c = c.sibling) self -= c.actualDuration ?? 0;
      self = Math.max(0, self);
      const name = nameOf(fiber);
      const entry = byName.get(name);
      if (entry) {
        entry.selfMs += self;
        entry.instances++;
        if (self > entry.heaviestMs) { entry.heaviest = fiber; entry.heaviestMs = self; }
      } else {
        byName.set(name, { selfMs: self, instances: 1, heaviest: fiber, heaviestMs: self });
      }
    }
    // Never climb `return`/root siblings: skipped subtrees point into the previous tree.
    if (fiber !== rootFiber && fiber.sibling) stack.push(fiber.sibling);
    if (fiber.child) stack.push(fiber.child);
  }

  const top = [...byName.entries()]
    .sort((a, b) => b[1].selfMs - a[1].selfMs)
    .slice(0, limit)
    .map(([name, e]) => {
      const el = firstElement(e.heaviest);
      const cls = el?.getAttribute('class')?.trim().split(/\s+/)[0] ?? null;
      return {
        name,
        selfMs: Math.round(e.selfMs),
        instances: e.instances,
        context: contextOf(e.heaviest),
        element: cls,
        visible: isDisplayed(el),
      };
    });
  return { totalMs: Math.round(rootFiber.actualDuration ?? 0), top };
}
