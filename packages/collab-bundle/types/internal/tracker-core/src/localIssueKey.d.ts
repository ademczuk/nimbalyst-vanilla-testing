/**
 * Local-only issue keys for tracker items that do not yet have a
 * server-assigned identity.
 *
 * The `NIM-###` namespace (or whatever the room's prefix is) belongs to the
 * tracker room and to nothing else. A client that mints into it is guessing,
 * and two clients guessing independently is how the same shared item ended up
 * under different room-owned keys on two clients: every create path
 * allocated a local `MAX(issue_number)+1` before the mutation was acked, and
 * the loser never converged.
 *
 * A synced item therefore carries an `LC-###` key between creation and the
 * ack. It is visibly not a real issue key, so nobody pastes it into a commit
 * message expecting `CommitTrackerLinker` to resolve it, and it never occupies
 * `issue_number` -- the column the room owns.
 */
export declare const LOCAL_ISSUE_KEY_PREFIX = "LC";
/**
 * The current local-number form: the project's own prefix, a dot, the number.
 *
 * The separator is the whole point. A team prefix is validated as two to five
 * uppercase letters, so a dot can never occur in one -- which means `NIM.12`
 * and `PROJ-12` cannot be confused, and telling them apart costs a regex rather
 * than a database lookup. That matters because local numbers do not stay
 * local: an agent handed one writes it into a commit message, and the only
 * property worth guaranteeing is that the escaped number fails loudly instead
 * of resolving to some other item.
 *
 * Length could not do this job. The room's prefix-conflict path already hands
 * back longer alternatives (NIM taken -> NIMA), so "local prefixes are longer"
 * would collide with real team keys.
 */
export declare const LOCAL_KEY_SEPARATOR = ".";
export declare function formatLocalKey(prefix: string, localNumber: number): string;
/** True for a dotted local number, whatever project prefix it carries. */
export declare function isLocalKeyReference(reference: string | null | undefined): boolean;
export declare function parseLocalKey(reference: string | null | undefined): {
    prefix: string;
    localNumber: number;
} | null;
/**
 * True for any reference that is a private handle rather than a shared key --
 * the recycled `LC-###` values still sitting in old databases, and the current
 * dotted form. Callers resolving user-typed references against the room's
 * namespace must refuse both.
 */
export declare function isPrivateIssueReference(reference: string | null | undefined): boolean;
export declare function formatLocalIssueKey(localNumber: number): string;
/**
 * True for a provisional local key. Callers that resolve user-typed references
 * (commit trailers, `Fixes` lines) must treat these as unresolvable rather than
 * matching them against the room's namespace.
 */
export declare function isLocalIssueKey(issueKey: string | null | undefined): boolean;
/**
 * How a key should be described to an agent or a user.
 *
 * A provisional key is not just "not final" -- it is actively unsafe to hold
 * onto. `nextLocalIssueNumber` derives the next suffix by scanning rows whose
 * key still starts with `LC-`, so once the ack rewrites `LC-2` to `PROJ-2615`
 * nothing matches and the counter resets: the next create is `LC-2` again.
 * A caller that stashed the first `LC-2` and later resolves it lands on a
 * different item entirely.
 */
export declare function describeIssueKey(issueKey: string | null | undefined, itemId: string): {
    ref: string;
    isProvisional: boolean;
    caveat: string | null;
};
/**
 * How an item's reference relates to the room's namespace, in three states
 * because there are three. `assigned` is a key the room owns and everyone
 * resolves the same way. `local` is this machine's private number: real and
 * stable, but not safe to put anywhere another person reads. `unassigned` is a
 * team draft genuinely waiting on the room. Collapsing `local` into
 * `unassigned` sent agents at a publish action a personal tracker refuses
 * outright (#1346).
 *
 * This module owns the type so every host describes the same three states.
 */
export type IssueKeyStatus = 'assigned' | 'local' | 'unassigned';
/**
 * The key to show for an item, or nothing when it has none worth showing.
 *
 * A team key first: it is the only form that means the same thing to everyone.
 * Then this machine's local number, which at least resolves in this project.
 * A leftover `LC-###` loses to both -- those values were reissued as items were
 * acked, so displaying one where a stable number exists points the reader at
 * whatever happens to hold that placeholder now.
 */
export declare function resolveDisplayIssueKey(item: {
    issueKey?: string | null;
    localKey?: string | null;
}): string | undefined;
/** Numeric suffix of a local key, or null when it is not one. */
export declare function parseLocalIssueNumber(issueKey: string | null | undefined): number | null;
/**
 * The settled wording for an item that has no key yet. An unkeyed draft is
 * normal and intentional, not a failure -- this sentence is what says so.
 *
 * These five sentences live here because every host states them: the app's
 * agent tools, the CLI, and the tracker UI. Hand-copies had already drifted --
 * only the runtime grew `TRACKER_LOCAL_ISSUE_KEY_MESSAGE`, so the tools and the
 * CLI kept telling a numbered personal item it had "no key until it is
 * published", on trackers where publishing is refused outright (#1346, #1243).
 */
export declare const TRACKER_UNASSIGNED_ISSUE_KEY_MESSAGE = "This item has no key until it is published.";
/**
 * The settled wording for a workspace that has no team to mint keys.
 *
 * "Publish it" is the advice the other messages imply, and it is a dead end
 * here: publication succeeds locally and then waits on a room that does not
 * exist. Saying so is the whole point -- #1346 sat for nine days because the
 * app reported a pending key instead of an absent room.
 */
export declare const TRACKER_NO_TEAM_ISSUE_KEY_MESSAGE = "This workspace has no team, so no shared issue key can be issued \u2014 publishing will not produce one.";
/**
 * The settled wording for this machine's private number. The point it has to
 * land is that the number is not shareable: the same value on a colleague's
 * machine is a different item, so pasting it into a commit or a message sends
 * them somewhere else or nowhere at all.
 */
export declare const TRACKER_LOCAL_ISSUE_KEY_MESSAGE: string;
/**
 * The same point in one line, for a diagnostic surface that lists several refs
 * at once and would be drowned by the full sentence. Lifted verbatim from the
 * wording `TrackerBlockedChip` states inline; that component should import this
 * rather than restate it, so the two never drift into different advice.
 */
export declare const TRACKER_LOCAL_ISSUE_KEY_BRIEF_MESSAGE = "Dotted refs are numbered on this machine only \u2014 they will not resolve for anyone else.";
/**
 * What a dependency cycle means and what to do about it. Two surfaces explain
 * this one deadlock -- `TrackerDependencyCycleBanner` and the hover card in
 * `TrackerBlockedChip` -- and hand-maintained copies of an explanation are how
 * two surfaces end up giving different advice about the same hazard.
 *
 * It reads correctly in both placements: the banner introduces the cycle in the
 * sentence before, and the chip's card has no antecedent, which is why the
 * subject is named rather than pronominal.
 */
export declare const TRACKER_DEPENDENCY_CYCLE_MESSAGE = "These items depend on each other, so none of them can become ready until one of the links is removed.";
