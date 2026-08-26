/**
 * One answer to "can this host draw the mode this saved view asks for?".
 *
 * A host that cannot draw a mode has three things to decide -- which modes the
 * picker offers, which mode the surface actually renders, and whether to say a
 * substitution happened -- and they are the same decision. Evaluated separately
 * they drift: the picker keeps offering a mode the body silently redraws as a
 * list, or the notice stops appearing for a substitution that still happens.
 *
 * Pure and host-agnostic on purpose. It takes the capability set and returns the
 * plan, so the decision is testable without mounting a surface.
 */
import type { TrackerViewMode } from '../trackers/index';
/**
 * What every host falls back to. `list` renders from the same rows as any other
 * mode with no additional state, so it is the one mode always available.
 */
export declare const VIEW_MODE_FALLBACK: TrackerViewMode;
/**
 * Structural, not `TrackerUICapabilities`: this module stays free of the
 * provider (and therefore of Jotai and React) so it can be called from module
 * scope. `TrackerUICapabilities` satisfies it.
 */
export interface ViewModeCapabilities {
    renderableViewModes: ReadonlySet<TrackerViewMode>;
}
export interface ResolvedViewMode {
    /** The mode to render. Equal to `requested` unless it was substituted. */
    mode: TrackerViewMode;
    /** True when the host could not draw `requested` and fell back. */
    substituted: boolean;
}
export declare function resolveViewMode(requested: TrackerViewMode, capabilities: ViewModeCapabilities): ResolvedViewMode;
