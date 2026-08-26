import { type ComponentProps, type JSX } from 'react';
type DisplayOptionsPanelComponent = typeof import('../../../runtime/src/plugins/TrackerPlugin/components/DisplayOptionsPanel').DisplayOptionsPanel;
export type LazyDisplayOptionsPanelProps = ComponentProps<DisplayOptionsPanelComponent>;
export declare function preloadDisplayOptionsPanel(): void;
/** Keeps the visible Display trigger eager while loading its popover on intent. */
export declare function LazyDisplayOptionsPanel(props: LazyDisplayOptionsPanelProps): JSX.Element;
export {};
