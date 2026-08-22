/**
 * WebSocket close codes the collab server uses to say "you may not be here".
 *
 * These are settled answers, not transient failures. Reconnecting after one
 * replays the same refused handshake forever: the server closes again, the
 * backoff caps out, and the user sees a surface that is permanently "connecting"
 * with nothing explaining why. Treat them as terminal and tell the user.
 *
 * Server side: `TeamRoom.closeUserConnectionsOnRooms` sends 4002 on removal;
 * rooms send 4003 when a live socket's access is re-checked and found revoked.
 */
export declare const COLLAB_CLOSE_REMOVED_FROM_TEAM = 4002;
export declare const COLLAB_CLOSE_ACCESS_REVOKED = 4003;
/**
 * True when the close frame means access was revoked, so the client must stop
 * retrying. Unknown codes stay retryable by design -- a transport blip must not
 * be mistaken for a policy decision.
 */
export declare function isCollabAccessRevokedCloseCode(code: number | undefined): boolean;
/** User-facing explanation for a terminal close, for surfacing in the UI. */
export declare function collabAccessRevokedMessage(code: number | undefined): string;
