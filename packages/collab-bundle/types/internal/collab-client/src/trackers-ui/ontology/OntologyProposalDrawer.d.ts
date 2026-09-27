import type { KnowledgeGraph } from './ontologyKnowledge';
import { type PlanEnv, type ProposalRequestDraft } from './ontologyProposals';
import { type OntologyRecordLike } from './ontologyRecords';
import { type WriteContext } from './ontologyWriter';
export type DrawerTarget = {
    kind: 'request';
    draft: ProposalRequestDraft;
    detail: string;
    pages: readonly OntologyRecordLike[];
} | {
    kind: 'proposal';
    id: string;
};
export declare function OntologyProposalDrawer({ target, onClose, proposals, graph, env, context, onOpenItem, onOpenProposal }: {
    target: DrawerTarget;
    onClose: () => void;
    proposals: ReadonlyMap<string, OntologyRecordLike>;
    graph: KnowledgeGraph;
    env: PlanEnv;
    context: WriteContext | null;
    onOpenItem?: (itemId: string) => void;
    /** Switch the drawer to a proposal, e.g. the request just written. */
    onOpenProposal: (id: string) => void;
}): import("react").JSX.Element;
