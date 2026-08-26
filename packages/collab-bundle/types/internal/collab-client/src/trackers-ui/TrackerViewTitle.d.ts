import type { JSX } from 'react';
interface TrackerViewTitleProps {
    fallbackTitle: string;
    activeSavedViewName?: string | null;
    savedViewDirty?: boolean;
    /** False for a built-in view: its name and definition come from code. */
    savedViewEditable?: boolean;
    showSaveViewAction?: boolean;
    onSaveView: (name: string) => void;
    onRenameSavedView: (name: string) => void;
    onUpdateSavedView: () => void;
    onExitSavedView: () => void;
}
export declare function TrackerViewTitle({ fallbackTitle, activeSavedViewName, savedViewDirty, savedViewEditable, showSaveViewAction, onSaveView, onRenameSavedView, onUpdateSavedView, onExitSavedView, }: TrackerViewTitleProps): JSX.Element;
export {};
