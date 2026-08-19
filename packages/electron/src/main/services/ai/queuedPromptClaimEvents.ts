export interface QueuedPromptClaimEvent {
  sessionId: string;
  promptId: string;
}

type Listener = (event: QueuedPromptClaimEvent) => void;

const listeners = new Set<Listener>();

export function subscribeQueuedPromptClaims(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function publishQueuedPromptClaim(event: QueuedPromptClaimEvent): void {
  for (const listener of listeners) listener(event);
}
