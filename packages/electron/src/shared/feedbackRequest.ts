import type {
  Actor,
  FeedbackAnswer,
  FeedbackDiscussionComment,
  FeedbackRequestCreateInput,
  FeedbackRequestLifecycleStatus,
  RichCommentBody,
} from '@nimbalyst/collab-protocol';
import type {
  FeedbackRequestServiceState,
  FeedbackRequestServiceTarget,
} from '@nimbalyst/collab-client/feedback';

export type {
  FeedbackRequestConnectionStatus,
  FeedbackRequestServiceState,
  FeedbackRequestServiceTarget,
} from '@nimbalyst/collab-client/feedback';

/**
 * The author as the renderer can honestly describe it: the session that drafted
 * the request. `onBehalfOfUserId` is deliberately absent -- it is the *org-scoped*
 * member id, which differs per organization and is only derivable from the team
 * JWT. Main stamps it during `create`, so a renderer cannot name someone else as
 * the author, and a personal user id can never be mistaken for a team one.
 */
export type FeedbackRequestAuthorInput = Omit<Actor, 'onBehalfOfUserId'>;

export interface FeedbackRequestCreateIpcRequest {
  target: FeedbackRequestServiceTarget;
  clientMutationId: string;
  request: Omit<FeedbackRequestCreateInput, 'author'> & {
    author: FeedbackRequestAuthorInput;
  };
}

export interface FeedbackRequestRespondIpcRequest {
  target: FeedbackRequestServiceTarget;
  clientMutationId: string;
  askId: string;
  answer: FeedbackAnswer;
}

export interface FeedbackRequestCommentIpcRequest {
  target: FeedbackRequestServiceTarget;
  clientMutationId: string;
  body: RichCommentBody;
  replyToCommentId?: string;
}

export type FeedbackRequestCommentIpcResult = FeedbackDiscussionComment;

export interface FeedbackRequestCloseIpcRequest {
  target: FeedbackRequestServiceTarget;
  clientMutationId: string;
  status: Exclude<FeedbackRequestLifecycleStatus, 'open'>;
}

export interface FeedbackRequestNudgeIpcRequest {
  target: FeedbackRequestServiceTarget;
  clientMutationId: string;
  recipientUserIds?: string[];
}
