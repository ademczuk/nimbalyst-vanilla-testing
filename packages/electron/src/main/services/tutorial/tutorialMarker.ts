import * as fs from "fs/promises";
import * as path from "path";

export const TUTORIAL_MARKER_FILE = ".nimbalyst-tutorial.json";

/**
 * A workspace is the tutorial project when it carries a marker file naming the
 * template version it was materialized from. Shared by the service that creates
 * the project and by anything that needs to recognize it later.
 */
export async function hasValidTutorialMarker(
  workspacePath: string
): Promise<boolean> {
  try {
    const markerContent = await fs.readFile(
      path.join(workspacePath, TUTORIAL_MARKER_FILE),
      "utf8"
    );
    const marker = JSON.parse(markerContent) as { templateVersion?: unknown };
    return (
      (typeof marker.templateVersion === "number" &&
        marker.templateVersion > 0) ||
      (typeof marker.templateVersion === "string" &&
        marker.templateVersion.trim().length > 0)
    );
  } catch {
    return false;
  }
}
