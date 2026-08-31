import { useEffect, useRef, type MutableRefObject } from 'react';
import { useTabsActions } from '../contexts/TabsContext';
import { resolveRepresentedFile } from '../utils/representedFile';

/** Send a represented-file change to main, skipping repeats of what was last sent. */
function pushIfChanged(
    lastSent: MutableRefObject<string | null | undefined>,
    filePath: string | null,
): void {
    if (filePath === lastSent.current) return;

    lastSent.current = filePath;
    window.electronAPI?.setRepresentedFile?.(filePath);
}

/**
 * #1375: Push the window's represented file (AXDocument) to the main process.
 *
 * Call from a component that stays mounted for as long as it could own the
 * window's identity. Agent mode unmounts its editor tabs in the
 * transcript-only layout, and an unmounted component cannot clear what it set.
 *
 * `isActive` marks the owner. The memo of what was last sent resets when this
 * instance goes inactive, so the next activation re-asserts its own file
 * rather than trusting what another owner left behind.
 */
export function usePushRepresentedFile(isActive: boolean, filePath: string | null): void {
    const lastSentRef = useRef<string | null | undefined>(undefined);

    useEffect(() => {
        if (!isActive) {
            lastSentRef.current = undefined;
            return;
        }

        pushIfChanged(lastSentRef, filePath);
    }, [isActive, filePath]);
}

/**
 * Represent the active tab of the surrounding TabsProvider. For editor-mode
 * style hosts, whose tabs and visibility live and die together.
 *
 * Reads the store through an effect-scoped subscription rather than `useTabs()`.
 * TabsContext exists so that a tab change re-renders only the components that
 * ask for tab data, and its hosts drive tab visibility imperatively through
 * refs; going through `useTabs()` would re-render the whole mode tree on every
 * tab open, close, switch, and reorder to feed a side effect that renders
 * nothing.
 */
export function useRepresentedFileSync(isActive: boolean): void {
    const { subscribe, getSnapshot } = useTabsActions();
    const lastSentRef = useRef<string | null | undefined>(undefined);

    useEffect(() => {
        if (!isActive) {
            lastSentRef.current = undefined;
            return;
        }

        const push = () => {
            const { tabs, activeTabId } = getSnapshot();
            const activeTab = activeTabId ? tabs.get(activeTabId) : null;
            pushIfChanged(lastSentRef, resolveRepresentedFile(activeTab?.filePath));
        };

        push();
        return subscribe(push);
    }, [isActive, subscribe, getSnapshot]);
}
