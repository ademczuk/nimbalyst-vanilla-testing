/**
 * The centered "nothing to show" block every tracker surface renders.
 *
 * Four surfaces had drifted copies of the same eight lines -- board, tag board,
 * grid, inbox -- differing only in icon and wording, and one of them had already
 * lost the muted-hint line the others kept. One component, so a surface added
 * later cannot start a fifth copy.
 */
import React from 'react';
export interface TrackerSurfaceMessageProps {
    icon: string;
    message: string;
    /** Second line, quieter: what the reader could do about it. */
    hint?: string;
    /** Action row under the hint, e.g. a create button. */
    children?: React.ReactNode;
    testId?: string;
}
export declare function TrackerSurfaceMessage({ icon, message, hint, children, testId, }: TrackerSurfaceMessageProps): React.JSX.Element;
