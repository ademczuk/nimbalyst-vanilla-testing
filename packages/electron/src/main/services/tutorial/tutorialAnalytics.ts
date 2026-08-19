import { AnalyticsService } from "../analytics/AnalyticsService";
import { hasValidTutorialMarker } from "./tutorialMarker";
import type { TutorialEntryPoint } from "../../../shared/tutorial";

export type { TutorialEntryPoint };

const TUTORIAL_ENTRY_POINTS = new Set<TutorialEntryPoint>([
  "onboarding",
  "welcome_pane",
  "project_manager_sidebar",
  "help_menu",
  "unknown",
]);

/**
 * How far into the tutorial the user actually got. `tutorial_started` says they
 * opened it; these say they used it.
 */
export type TutorialMilestone = "session_opened" | "prompt_sent";

export function normalizeTutorialEntryPoint(value: unknown): TutorialEntryPoint {
  return TUTORIAL_ENTRY_POINTS.has(value as TutorialEntryPoint)
    ? (value as TutorialEntryPoint)
    : "unknown";
}

export function captureTutorialStarted(
  entryPoint: TutorialEntryPoint,
  reused: boolean
): void {
  AnalyticsService.getInstance().sendEvent("tutorial_started", {
    entryPoint,
    reused,
  });
}

// Milestones answer "did this user ever get this far", so one per workspace per
// app run is the whole signal. Without this, `prompt_sent` would fire on every
// message the user sends inside the tutorial.
const reportedMilestones = new Set<string>();

/**
 * Emits a tutorial milestone if (and only if) the workspace is the tutorial
 * project. Safe to call from any workspace-scoped path — non-tutorial
 * workspaces cost one marker-file stat and emit nothing.
 */
export async function captureTutorialMilestone(
  workspacePath: string | null | undefined,
  milestone: TutorialMilestone
): Promise<void> {
  if (!workspacePath) return;

  const key = `${workspacePath}::${milestone}`;
  if (reportedMilestones.has(key)) return;

  if (!(await hasValidTutorialMarker(workspacePath))) return;

  // Re-check after the await: two concurrent callers can both pass the first
  // guard while the marker read is in flight.
  if (reportedMilestones.has(key)) return;
  reportedMilestones.add(key);

  AnalyticsService.getInstance().sendEvent("tutorial_progressed", {
    milestone,
  });
}
