/**
 * Live tracker references for hosts that resolve them from a
 * `TrackerDataSource`. Its own subpath so the collab bundle's editor entry can
 * register the renderer without importing the tracker-ui barrel.
 */
export { createTrackerReferenceResolver } from './trackerReferenceResolver';
export type { CreateTrackerReferenceResolverOptions, TrackerBacklink, TrackerReferenceActor, TrackerReferenceResolution, TrackerReferenceResolver, TrackerReferenceSchema, TrackerReferenceSearchResult, TrackerReferenceStatusInfo, TrackerReferenceTypeInfo, TrackerStatement, TrackerStatementGroup, } from './trackerReferenceResolver';
export { TrackerReferenceResolverContext, TrackerReferenceResolverProvider, useTrackerBacklinks, useTrackerReference, useTrackerReferenceResolver, useTrackerStatements, } from './TrackerReferenceResolverContext';
export { TrackerReferenceInlineAppearanceContext, useTrackerReferenceInlineAppearance, } from './TrackerReferenceQuietLink';
export type { TrackerReferenceInlineAppearance } from './TrackerReferenceQuietLink';
export { LiveTrackerReferenceRenderer, TrackerReferenceChipView, } from './TrackerReferenceViews';
export type { LiveTrackerReferenceRendererProps, TrackerReferenceViewKind, } from './TrackerReferenceViews';
export { TrackerStateMenu } from './TrackerStateMenuLazy';
export type { TrackerStateChange, TrackerStateMenuProps } from './TrackerStateMenu';
export { stateTone } from './trackerReferenceLifecycle';
export type { StateTone, TrackerReferenceStatusOption } from './trackerReferenceLifecycle';
