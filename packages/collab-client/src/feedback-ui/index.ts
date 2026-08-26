export * from './FeedbackRequestRespond';
export * from './FeedbackRespondAskField';
export * from './FeedbackRespondOptionCards';
export * from './FeedbackArtifactSubjects';
export * from './ArtifactViewport';
export * from './ScaledPreviewFrame';
export * from './artifactScrollCarry';
export * from './useLivePreviewSlot';

/*
 * Types only, deliberately. The popover pulls in `@floating-ui/react`, and a
 * value export here would put it in this entry's *eager* graph -- which is
 * measured, and which it blew straight past (35 KB ceiling, 58.8 KB actual)
 * the first time it was exported normally.
 *
 * Nothing outside this package needs the component: a host supplies
 * `renderArtifactDetail` and the ask field mounts the popover lazily, on the
 * click that opens it. These are the types that crossing that seam requires.
 */
export type {
  FeedbackArtifactDetailEntry,
  FeedbackArtifactDetailMountApi,
  FeedbackArtifactDetailPopoverProps,
  FeedbackArtifactDetailRenderer,
  FeedbackArtifactScrollViewport,
} from './FeedbackArtifactDetailPopover';
