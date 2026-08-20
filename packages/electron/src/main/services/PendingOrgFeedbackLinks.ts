/**
 * The per-workspace queue of org feedback-request deep links waiting for a
 * renderer to be ready — a window we just created for the project, or one
 * still mounting its listeners when the link arrived.
 *
 * Consuming is destructive: whoever asks first also clears the entry. So the
 * workspace path the renderer names cannot be the only thing deciding which
 * entry it gets. A renderer that names *another* project's path would take
 * that project's queued request and delete it, and the window the link was
 * actually routed to would then find nothing queued. The caller resolves the
 * sender's own workspace from its window and hands both paths in here.
 */

export interface PendingOrgFeedbackLink {
    requestId: string;
    orgId: string;
}

export interface ConsumedOrgFeedbackLink extends PendingOrgFeedbackLink {
    workspacePath: string;
}

const pendingByWorkspace = new Map<string, PendingOrgFeedbackLink>();

export function queuePendingOrgFeedbackLink(
    workspacePath: string,
    link: PendingOrgFeedbackLink,
): void {
    pendingByWorkspace.set(workspacePath, link);
}

/**
 * Hand the queued link to the window it was queued for, and only that window.
 *
 * @param requestedWorkspacePath the path the renderer asked for
 * @param senderWorkspacePath the path resolved from the sender's own window
 */
export function consumePendingOrgFeedbackLink(
    requestedWorkspacePath: string | null | undefined,
    senderWorkspacePath: string | null | undefined,
): ConsumedOrgFeedbackLink | null {
    if (!requestedWorkspacePath) return null;
    if (!senderWorkspacePath || senderWorkspacePath !== requestedWorkspacePath) return null;
    const pending = pendingByWorkspace.get(requestedWorkspacePath);
    if (!pending) return null;
    pendingByWorkspace.delete(requestedWorkspacePath);
    return { ...pending, workspacePath: requestedWorkspacePath };
}

/** Test seam — the queue is module state for the life of the main process. */
export function clearPendingOrgFeedbackLinks(): void {
    pendingByWorkspace.clear();
}
