/**
 * URN formation and parsing for resource references and message deep links.
 *
 * The plan fixes exactly one of these forms:
 *
 *   nimbalyst://conversation/<id>/message/<messageId>
 *
 * The rest are derived from it so that every `ResourceRef.kind` has one
 * canonical spelling, and so `parse(format(ref))` round-trips. Anything that
 * does not round-trip is a bug, not a rendering nuance -- the composer writes
 * these strings into the body and the renderer has to recover the same ref.
 *
 * Mentions get a URN too (`nimbalyst://user/<id>`), but a mention is NOT a
 * `ResourceRef`: the protocol has no `user` kind. Mentions are authorized
 * through `Comment.deliveryHints.mentionedUserIds` instead, which is why
 * `parseResourceUrn` returns null for them and `parseMentionUrn` exists.
 */

import { feedbackRequestUrn, parseFeedbackRequestUrn } from '@nimbalyst/collab-protocol';
import type { CommentRef, ResourceRef, ResourceKind } from './commentTypes';

const SCHEME = 'nimbalyst://';

/** Path segment used in URNs for each ref kind, where it differs from the kind. */
const KIND_SEGMENT: Record<ResourceKind, string> = {
  tracker: 'tracker',
  document: 'document',
  session: 'session',
  conversation: 'conversation',
  file: 'file',
  commit: 'commit',
  pullRequest: 'pull',
  // Matches `feedbackRequestUrn`, which stays the authority for forming one.
  feedbackRequest: 'feedback-request',
};

const SEGMENT_KIND: Record<string, ResourceKind> = Object.fromEntries(
  (Object.entries(KIND_SEGMENT) as [ResourceKind, string][]).map(([kind, segment]) => [segment, kind]),
);

/** Kinds scoped under a project, which the protocol validator requires a projectId for. */
const PROJECT_SCOPED: ReadonlySet<ResourceKind> = new Set<ResourceKind>(['file', 'commit', 'pullRequest']);

export function isProjectScopedKind(kind: ResourceKind): boolean {
  return PROJECT_SCOPED.has(kind);
}

/**
 * Canonical URN for a resource reference.
 *
 * Segments are percent-encoded because file refs carry workspace-relative
 * paths, which legitimately contain slashes and spaces.
 */
export function resourceRefToUrn(ref: ResourceRef): string {
  if (ref.kind === 'feedbackRequest') {
    return feedbackRequestUrn(ref.sourceId);
  }
  const segment = KIND_SEGMENT[ref.kind];
  const id = encodeURIComponent(ref.sourceId);
  if (PROJECT_SCOPED.has(ref.kind)) {
    return `${SCHEME}project/${encodeURIComponent(ref.projectId ?? '')}/${segment}/${id}`;
  }
  if (ref.kind === 'conversation' && ref.messageId) {
    return `${SCHEME}conversation/${id}/message/${encodeURIComponent(ref.messageId)}`;
  }
  return `${SCHEME}${segment}/${id}`;
}

/**
 * Parse a URN back into a `ResourceRef`.
 *
 * `orgId` is supplied by the caller because a URN is org-relative: it is only
 * ever resolved in the context of the conversation it was read from, and
 * accepting a cross-org id out of body text would be a trust hole.
 */
export function parseResourceUrn(urn: string, orgId: string): ResourceRef | null {
  const feedbackRequestId = parseFeedbackRequestUrn(urn);
  if (feedbackRequestId) {
    return { orgId, kind: 'feedbackRequest', sourceId: feedbackRequestId };
  }
  if (!urn.startsWith(SCHEME)) return null;
  const parts = urn.slice(SCHEME.length).split('/').filter((part) => part.length > 0);
  if (parts.length < 2) return null;

  if (parts[0] === 'project') {
    if (parts.length !== 4) return null;
    const kind = SEGMENT_KIND[parts[2]];
    if (!kind || !PROJECT_SCOPED.has(kind)) return null;
    const projectId = safeDecode(parts[1]);
    const sourceId = safeDecode(parts[3]);
    if (projectId === null || sourceId === null || projectId === '') return null;
    return { orgId, kind, sourceId, projectId };
  }

  const kind = SEGMENT_KIND[parts[0]];
  if (!kind || PROJECT_SCOPED.has(kind)) return null;

  const sourceId = safeDecode(parts[1]);
  if (sourceId === null || sourceId === '') return null;

  if (kind === 'conversation' && parts.length === 4 && parts[2] === 'message') {
    const messageId = safeDecode(parts[3]);
    if (messageId === null || messageId === '') return null;
    return { orgId, kind, sourceId, messageId };
  }
  if (parts.length !== 2) return null;
  return { orgId, kind, sourceId };
}

export interface PastedResourceLink {
  ref: ResourceRef;
  label: string;
}

/**
 * Turn the shareable URLs copied elsewhere in Nimbalyst into the canonical
 * resource reference messaging stores.
 *
 * Two spellings meet here and nowhere else. A copied link is addressed for the
 * OS protocol handler: it spells a shared document `doc` and carries its
 * organization in the query string, because it can be opened from outside
 * Nimbalyst. A stored reference is addressed for a conversation: it spells the
 * same thing `document` and takes the organization from the conversation it
 * was read in. Translating at this boundary is what keeps the stored body
 * format unchanged and `parse(format(ref))` round-tripping.
 *
 * A message is already organization-scoped, so a foreign-org link must stay
 * literal text rather than being authorized as a reference in this
 * conversation. A link with no `orgId` is already org-relative and is read as
 * belonging to this one.
 */
export function parsePastedResourceLink(
  rawValue: string,
  orgId: string,
): PastedResourceLink | null {
  const value = rawValue.trim();
  if (!value) return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'nimbalyst:') return null;

  const linkOrgId = parsed.searchParams.get('orgId');
  if (linkOrgId !== null && linkOrgId !== orgId) return null;

  const route = pastedLinkRoute(parsed);
  if (!route) return null;

  const sourceId = safeDecode(route.encodedSourceId);
  if (sourceId === null || sourceId === '') return null;

  if (route.host === 'doc') {
    // A `thread` parameter may ride along from "copy link" on a comment; it is
    // presentation intent for the opener, not part of the document's identity.
    return { ref: { orgId, kind: 'document', sourceId }, label: 'Document' };
  }

  const rawView = parsed.searchParams.get('view');
  if (rawView !== null && rawView !== 'document') return null;

  return {
    ref: {
      orgId,
      kind: 'tracker',
      sourceId,
    },
    label: rawView === 'document' ? 'Plan' : 'Tracker',
  };
}

/** Hosts a pasted link may address. `folder` is absent: there is no such kind. */
const PASTED_LINK_HOSTS = ['tracker', 'doc'] as const;

/**
 * Both `nimbalyst://doc/x` (host form) and `nimbalyst:///doc/x` (path form)
 * reach us, because a non-special scheme leaves the authority optional.
 */
function pastedLinkRoute(
  parsed: URL,
): { host: (typeof PASTED_LINK_HOSTS)[number]; encodedSourceId: string } | null {
  for (const host of PASTED_LINK_HOSTS) {
    if (parsed.host === host) {
      return { host, encodedSourceId: parsed.pathname.replace(/^\//, '') };
    }
    if (parsed.host === '' && parsed.pathname.startsWith(`/${host}/`)) {
      return { host, encodedSourceId: parsed.pathname.slice(host.length + 2) };
    }
  }
  return null;
}

/** `nimbalyst://user/<userId>`. Not a ResourceRef -- see the module header. */
export function mentionUrn(userId: string): string {
  return `${SCHEME}user/${encodeURIComponent(userId)}`;
}

export function parseMentionUrn(urn: string): string | null {
  if (!urn.startsWith(`${SCHEME}user/`)) return null;
  const rest = urn.slice(SCHEME.length + 'user/'.length);
  if (rest.includes('/')) return null;
  const userId = safeDecode(rest);
  return userId === null || userId === '' ? null : userId;
}

/** Agent mentions reuse the session URN so one token addresses one session. */
export function agentMentionUrn(sessionId: string): string {
  return `${SCHEME}session/${encodeURIComponent(sessionId)}`;
}

export function parseAgentMentionUrn(urn: string): string | null {
  if (!urn.startsWith(`${SCHEME}session/`)) return null;
  const rest = urn.slice(SCHEME.length + 'session/'.length);
  if (rest.includes('/')) return null;
  const sessionId = safeDecode(rest);
  return sessionId === null || sessionId === '' ? null : sessionId;
}

/** Conversation-scoped sources whose comments are addressable messages. */
const CONVERSATION_SOURCE_KINDS: ReadonlySet<CommentRef['sourceKind']> = new Set([
  'roomMessage',
  'documentDiscussion',
  'dmMessage',
]);

/**
 * `Copy link to message` target.
 *
 * Returns null for tracker comments and inline document comments: they are not
 * conversations, so minting a `nimbalyst://conversation/...` URN for them would
 * produce a link that resolves to nothing. The action is hidden rather than
 * offered and broken.
 */
export function messageUrn(ref: CommentRef): string | null {
  if (!CONVERSATION_SOURCE_KINDS.has(ref.sourceKind)) return null;
  if (!ref.sourceId || !ref.commentId) return null;
  return `${SCHEME}conversation/${encodeURIComponent(ref.sourceId)}/message/${encodeURIComponent(ref.commentId)}`;
}

export function conversationUrn(conversationId: string): string {
  return `${SCHEME}conversation/${encodeURIComponent(conversationId)}`;
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
