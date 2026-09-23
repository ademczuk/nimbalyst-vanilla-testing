import type {
  TrackerCoreContext,
  TrackerTypeModel,
} from "@nimbalyst/tracker-core";
import { globalRegistry } from "./TrackerDataModel.js";

/** Runtime adapter only: core semantics receive the active registry per call. */
export const runtimeTrackerContext: TrackerCoreContext = {
  getTypeModel: (type) =>
    globalRegistry.get(type) as unknown as TrackerTypeModel | undefined,
};
