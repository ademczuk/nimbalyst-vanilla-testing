// ---------------------------------------------------------------------------
// Node z-order ranks
// ---------------------------------------------------------------------------

/**
 * Key under which a node's z-order rank lives inside the collaborative node
 * map. Namespaced so it can never collide with a spec field or a foreign key.
 *
 * WHY A RANK STRING, AND WHY NOT IN THE FILE:
 *
 * JSON Canvas encodes z-order as node array position ("the first node in the
 * array should be displayed below all other nodes"). An array index is the
 * worst possible representation inside a CRDT -- inserting at the front
 * rewrites every later index, and two clients inserting concurrently produce
 * conflicting indices under last-write-wins. So in the shared document the
 * order travels *with* the node as a lexicographically-sortable fractional
 * index (Figma/Jira-style rank strings): an insert writes one key, never N,
 * and concurrent inserts settle deterministically instead of fighting.
 *
 * Rank strings rather than fractional floats because floats run out of
 * mantissa after ~50 consecutive midpoint inserts at the same spot and then
 * silently collapse order; a digit string has no such cliff.
 *
 * The rank is *not* written to the file. Array position already persists
 * z-order faithfully, and a second on-disk representation of the same fact is
 * exactly the divergence hazard that makes stale duplicated geometry a bug.
 * Ranks are derived from array order on load and reconciled (not rewritten) on
 * re-read, so an unchanged file costs zero writes.
 *
 * A rank is an ordering key, not a paint value. A renderer that wants a
 * numeric z-index sorts with {@link compareCanvasRank} and uses each node's
 * position in that sorted array -- the numbers themselves carry no meaning,
 * only their relative order, which is exactly what the spec specifies.
 */
export const CANVAS_NODE_RANK_FIELD = 'x-nimbalyst-z';

/** ASCII-ascending digits, so string compare equals numeric compare. */
const RANK_DIGITS =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const RANK_BASE = RANK_DIGITS.length;

/**
 * Repeatedly inserting at the same spot lengthens the rank by roughly one
 * digit per six inserts, which is inherent to fractional indexing. The bound
 * below is a runaway guard, not a real limit: reaching it takes ~24,000
 * consecutive inserts between the same two neighbours, and widening always
 * terminates while `lower < upper` holds.
 */
const RANK_MAX_WIDTH = 4096;

/**
 * A rank strictly between `lower` and `upper`, either of which may be null to
 * mean "no bound" (bottom / top of the stack).
 */
export function canvasRankBetween(
  lowerBound: string | null,
  upperBound: string | null
): string {
  const lower = normalizeCanvasRank(lowerBound);
  const upper = normalizeCanvasRank(upperBound);
  if (lower !== null && upper !== null && lower >= upper) {
    throw new RangeError('Canvas rank bounds must be strictly increasing');
  }
  if (upper === null) return rankAfter(lower);

  // Treat both bounds as base-62 fractions, add them, halve the sum, and widen
  // by a digit whenever the two bounds are adjacent at the current width.
  for (
    let width = Math.max(lower?.length ?? 0, upper.length, 1);
    width < RANK_MAX_WIDTH;
    width += 1
  ) {
    const sum = new Array<number>(width + 1).fill(0);
    let carry = 0;
    for (let index = width - 1; index >= 0; index -= 1) {
      const total =
        rankDigitAt(lower, index) + rankDigitAt(upper, index) + carry;
      sum[index + 1] = total % RANK_BASE;
      carry = total >= RANK_BASE ? 1 : 0;
    }
    sum[0] = carry;

    const half = new Array<number>(width + 1).fill(0);
    let remainder = 0;
    for (let index = 0; index <= width; index += 1) {
      const value = remainder * RANK_BASE + sum[index];
      half[index] = Math.floor(value / 2);
      remainder = value % 2;
    }

    // A rank may never end in the lowest digit: trailing zeros are
    // value-neutral for a fraction but not for a string compare, so allowing
    // them would break the ordering and leave no room to insert below.
    const candidate = normalizeCanvasRank(
      half
        .slice(1)
        .map((digit) => RANK_DIGITS[digit])
        .join('')
    );
    if (
      candidate !== null &&
      (lower === null || candidate > lower) &&
      candidate < upper
    ) {
      return candidate;
    }
  }
  throw new RangeError('Canvas rank space exhausted');
}

/** `count` evenly spaced ranks, leaving room above, below, and between. */
export function canvasRankSequence(count: number): string[] {
  if (count <= 0) return [];
  let width = 1;
  let span = RANK_BASE;
  while (span <= count && width < 8) {
    width += 1;
    span *= RANK_BASE;
  }
  return Array.from({ length: count }, (_unused, index) =>
    rankFromValue(Math.floor(((index + 1) * span) / (count + 1)), width)
  );
}

/**
 * Order two ranks, either of which may be null for "no rank recorded".
 *
 * Unranked sorts last, i.e. on top: a node in the shared map with no rank was
 * created outside the codec, and "just added" is the likely reason. Callers
 * tie-break equal results themselves (by node id) so the order is total.
 *
 * This is the single definition of canvas stacking order -- the codec sorts
 * exported nodes with it, and any surface or binding that needs a paint order
 * must use it rather than re-deriving one.
 */
export function compareCanvasRank(
  left: string | null,
  right: string | null
): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Coerce a stored value into a usable rank, or null when it is not one.
 * Trailing zeros are stripped so string compare stays a faithful order, and a
 * value containing a non-digit is rejected rather than silently misordered.
 */
export function normalizeCanvasRank(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/0+$/, '');
  if (trimmed.length === 0) return null;
  for (const character of trimmed) {
    if (!RANK_DIGITS.includes(character)) return null;
  }
  return trimmed;
}

function rankAfter(lower: string | null): string {
  if (lower === null || lower.length === 0) {
    return RANK_DIGITS[Math.floor(RANK_BASE / 2)];
  }
  for (let index = lower.length - 1; index >= 0; index -= 1) {
    const digit = rankDigitAt(lower, index);
    if (digit < RANK_BASE - 1) {
      return lower.slice(0, index) + RANK_DIGITS[digit + 1];
    }
  }
  return lower + RANK_DIGITS[Math.floor(RANK_BASE / 2)];
}

function rankDigitAt(rank: string | null, index: number): number {
  const character = rank?.[index];
  if (character === undefined) return 0;
  const digit = RANK_DIGITS.indexOf(character);
  return digit < 0 ? 0 : digit;
}

function rankFromValue(value: number, width: number): string {
  let remaining = value;
  const digits: string[] = [];
  for (let index = 0; index < width; index += 1) {
    digits.unshift(RANK_DIGITS[remaining % RANK_BASE]);
    remaining = Math.floor(remaining / RANK_BASE);
  }
  return normalizeCanvasRank(digits.join('')) ?? RANK_DIGITS[1];
}
