import { createContext, useContext, useSyncExternalStore, type JSX, type ReactNode } from 'react';

import type {
  TrackerBacklink,
  TrackerReferenceResolution,
  TrackerReferenceResolver,
  TrackerStatementGroup,
} from './trackerReferenceResolver';

/**
 * The resolver live reference views read. Null means the host supplied none,
 * and the views fall back to the store-free key-only chip.
 */
export const TrackerReferenceResolverContext = createContext<TrackerReferenceResolver | null>(null);

export function TrackerReferenceResolverProvider({
  resolver,
  children,
}: {
  resolver: TrackerReferenceResolver | null | undefined;
  children: ReactNode;
}): JSX.Element {
  return (
    <TrackerReferenceResolverContext.Provider value={resolver ?? null}>
      {children}
    </TrackerReferenceResolverContext.Provider>
  );
}

export function useTrackerReferenceResolver(): TrackerReferenceResolver | null {
  return useContext(TrackerReferenceResolverContext);
}

export function useTrackerReference(
  resolver: TrackerReferenceResolver,
  key: string,
): TrackerReferenceResolution {
  const read = () => resolver.resolve(key);
  return useSyncExternalStore(resolver.subscribe, read, read);
}

export function useTrackerStatements(
  resolver: TrackerReferenceResolver,
  itemId: string,
): readonly TrackerStatementGroup[] {
  const read = () => resolver.statementsAbout(itemId);
  return useSyncExternalStore(resolver.subscribe, read, read);
}

export function useTrackerBacklinks(
  resolver: TrackerReferenceResolver,
  itemId: string,
): readonly TrackerBacklink[] {
  const read = () => resolver.backlinks(itemId);
  return useSyncExternalStore(resolver.subscribe, read, read);
}
