/**
 * The app's entry point to the shared activity writer.
 *
 * The logic lives in `@nimbalyst/tracker-core` because the CLI's offline write
 * path has to produce identical stored bytes; keeping a second copy here is how
 * the two drifted on coalescing before. `DirectGateway.write.test.ts` compares a
 * CLI-written row against what this module produces, so the parity claim is
 * checked rather than asserted in a comment.
 */
export { appendActivity } from '@nimbalyst/tracker-core';
