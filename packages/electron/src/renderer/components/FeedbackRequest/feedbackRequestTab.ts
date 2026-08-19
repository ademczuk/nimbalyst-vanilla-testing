/**
 * The results tab's identity.
 *
 * A feedback request opens as its own tab rather than as a message, because it
 * is a resource: it outlives the conversation it was delivered in, and the
 * author comes back to it. The tab key follows the existing non-filesystem tab
 * convention (`virtual://`, same family as the Shared Docs Home tab), so
 * TabsContext already treats it as having no file on disk -- no watcher, no
 * dirty state, no save path -- without a special case.
 *
 * TabsContext imports it for the tab title, so it must not pull React or the
 * collaboration layer in behind it. Plain atom modules are fine — the open path
 * below needs the window mode and the workstream's layout to decide whether
 * anything is mounted to receive the open.
 */

import { store } from '@nimbalyst/runtime/store';

import { setWindowModeAtom, windowModeAtom } from '../../store/atoms/windowMode';
import {
  addWorkstreamFeedbackRequestAtom,
  feedbackRequestResource,
  setWorkstreamLayoutModeAtom,
  workstreamLayoutModeAtom,
  type WorkstreamResource,
} from '../../store/atoms/workstreamState';

export const FEEDBACK_REQUEST_TAB_PREFIX = 'virtual://feedback-request/';
export const FEEDBACK_REQUEST_TAB_TITLE = 'Feedback request';

/** Dispatched at an already-mounted workstream, mirroring the tracker open. */
export const FEEDBACK_REQUEST_OPEN_EVENT = 'nimbalyst:workstream-open-feedback-request';

export interface FeedbackRequestTabRef {
  orgId: string;
  requestId: string;
}

export function feedbackRequestTabUri({ orgId, requestId }: FeedbackRequestTabRef): string {
  return `${FEEDBACK_REQUEST_TAB_PREFIX}${encodeURIComponent(orgId)}/${encodeURIComponent(requestId)}`;
}

export function isFeedbackRequestTab(filePath: string): boolean {
  return filePath.startsWith(FEEDBACK_REQUEST_TAB_PREFIX);
}

export function parseFeedbackRequestTabUri(filePath: string): FeedbackRequestTabRef | null {
  if (!isFeedbackRequestTab(filePath)) return null;
  const [encodedOrgId, encodedRequestId, ...rest] = filePath
    .slice(FEEDBACK_REQUEST_TAB_PREFIX.length)
    .split('/');
  if (!encodedOrgId || !encodedRequestId || rest.length > 0) return null;
  try {
    const orgId = decodeURIComponent(encodedOrgId);
    const requestId = decodeURIComponent(encodedRequestId);
    return orgId && requestId ? { orgId, requestId } : null;
  } catch {
    return null;
  }
}

/**
 * The typed workstream resource for a live tab, or null when the tab is not a
 * feedback request. Lives here so the tab uri format has exactly one reader.
 */
export function feedbackRequestResourceForTab(filePath: string): WorkstreamResource | null {
  const ref = parseFeedbackRequestTabUri(filePath);
  return ref ? feedbackRequestResource({ resourceId: filePath, ...ref }) : null;
}

/**
 * Open a request's results tab from whatever the author is looking at.
 *
 * Only the workstream editor strip can host the tab, and that strip is not
 * mounted outside Agent Mode or in a transcript-only layout — the send
 * succeeded and no tab appeared, because nothing was listening. Same two-path
 * shape as the tracker open, for the same reasons:
 *
 * - Mounted: dispatch, and let the strip open the tab. TabsContext is
 *   authoritative once mounted; seeding `openResources` behind its back would
 *   fight the mirror the strip writes back on every tab change.
 * - Not mounted: seed the resource, then reveal a surface that can host it. The
 *   strip projects the seeded resource as it mounts, once, and from then on the
 *   mirror is what keeps the two in step — so closing the tab removes it for
 *   good rather than leaving something to re-derive.
 *
 * Seeding before the reveal is load-bearing, not incidental ordering: the panel
 * collapses its editor area the moment a workstream has no open resources, so a
 * layout flip that arrives first is undone before the strip can open anything.
 */
export function openFeedbackRequestResults(
  detail: FeedbackRequestTabRef & { workstreamId: string },
): void {
  const { workstreamId, orgId, requestId } = detail;
  const inAgentMode = store.get(windowModeAtom) === 'agent';
  const layoutMode = store.get(workstreamLayoutModeAtom(workstreamId));

  if (inAgentMode && layoutMode !== 'transcript') {
    window.dispatchEvent(new CustomEvent(FEEDBACK_REQUEST_OPEN_EVENT, { detail }));
    return;
  }

  store.set(addWorkstreamFeedbackRequestAtom, {
    workstreamId,
    resourceId: feedbackRequestTabUri({ orgId, requestId }),
    orgId,
    requestId,
  });
  if (layoutMode === 'transcript') {
    store.set(setWorkstreamLayoutModeAtom, { workstreamId, mode: 'split' });
  }
  if (!inAgentMode) {
    store.set(setWindowModeAtom, 'agent');
  }
}
