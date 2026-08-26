import { type Placement, type ReferenceElement, type Strategy, type UseDismissProps, type UseFloatingReturn } from '@floating-ui/react';
export { FloatingPortal } from '@floating-ui/react';
export interface UseTrackerFloatingMenuOptions {
    placement?: Placement;
    offsetPx?: number;
    viewportPadding?: number;
    strategy?: Strategy;
    constrainHeight?: boolean;
    reference?: ReferenceElement | null;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    dismiss?: UseDismissProps;
}
export interface UseTrackerFloatingMenuReturn {
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
    refs: UseFloatingReturn['refs'];
    floatingStyles: UseFloatingReturn['floatingStyles'];
    getReferenceProps: () => Record<string, unknown>;
    getFloatingProps: () => Record<string, unknown>;
    context: UseFloatingReturn['context'];
}
/** Shared tracker-menu positioning for desktop and browser hosts. */
export declare function useTrackerFloatingMenu(options?: UseTrackerFloatingMenuOptions): UseTrackerFloatingMenuReturn;
