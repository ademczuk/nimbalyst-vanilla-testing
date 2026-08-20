// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import {
    clearPendingOrgFeedbackLinks,
    consumePendingOrgFeedbackLink,
    queuePendingOrgFeedbackLink,
} from '../PendingOrgFeedbackLinks';

/**
 * The consume is destructive, and the IPC that reaches it carries a
 * renderer-supplied path. What is pinned here is that the path a caller names
 * never decides on its own which entry it gets — otherwise one project's
 * window drains another's queued request, and the window the link was actually
 * routed to comes up empty with nothing left to consume.
 */
describe('pending org feedback links', () => {
    beforeEach(() => clearPendingOrgFeedbackLinks());

    it('answers only the window whose own workspace matches, leaving the entry for it', () => {
        queuePendingOrgFeedbackLink('/workspace/acme', { requestId: 'req-1', orgId: 'org-a' });

        // A renderer whose own project is /workspace/beta naming Acme's path.
        expect(consumePendingOrgFeedbackLink('/workspace/acme', '/workspace/beta')).toBeNull();
        // A window with no resolvable workspace at all.
        expect(consumePendingOrgFeedbackLink('/workspace/acme', undefined)).toBeNull();

        // Acme's own window still finds it queued.
        expect(consumePendingOrgFeedbackLink('/workspace/acme', '/workspace/acme')).toEqual({
            requestId: 'req-1',
            orgId: 'org-a',
            workspacePath: '/workspace/acme',
        });
        // And the entry is gone, so a workspace switch cannot replay it.
        expect(consumePendingOrgFeedbackLink('/workspace/acme', '/workspace/acme')).toBeNull();
    });
});
