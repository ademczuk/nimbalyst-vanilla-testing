import type { PredicateDefinition, TrackerDataModel } from '@nimbalyst/tracker-schema';
import { type OntologyRecordLike } from './ontologyRecords';
import type { TrackerCommandFn } from './ontologyWriter';
import './ontologyInspector.css';
export type OntologyInspectorView = 'track' | 'map';
export interface OntologyInspectorWriter {
    command: TrackerCommandFn;
    /** The project new proposals are created in. */
    workspace: string;
    actor: string | null;
}
export interface OntologyInspectorProps {
    types: readonly TrackerDataModel[];
    /** Null when the host cannot read the room's registry; predicates are then keyed off claim ids. */
    predicates?: readonly PredicateDefinition[] | null;
    records: readonly OntologyRecordLike[];
    /** Null for a reader who may not write: proposals can be read but not created or decided. */
    writer: OntologyInspectorWriter | null;
    /** False until the room's first snapshot arrives, so an empty room is not mistaken for one still loading. */
    loaded?: boolean;
    onOpenItem?: (itemId: string) => void;
    initialView?: OntologyInspectorView;
    /** Injected in tests; the inspector otherwise judges stale facts against the time it opened. */
    now?: number;
}
export declare function OntologyInspector({ types, predicates, records, writer, loaded, onOpenItem, initialView, now: fixedNow }: OntologyInspectorProps): import("react").JSX.Element;
