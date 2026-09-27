import type { DomainGap } from './ontologyDomain';
import { type GapAction } from './OntologyParts';
export interface ProposalSummary {
    id: string;
    title: string;
    status: string;
}
export declare function proposalStatusLabel(status: string): string;
export declare function OntologyGapList({ gaps, gapAction, limit }: {
    gaps: readonly DomainGap[];
    gapAction: (gap: DomainGap) => GapAction;
    limit?: number;
}): import("react").JSX.Element;
export declare function OntologyProposalList({ proposals, onOpenProposal }: {
    proposals: readonly ProposalSummary[];
    onOpenProposal: (id: string) => void;
}): import("react").JSX.Element;
/** The right-hand rail of "What we track". */
export declare function OntologyRail({ title, subtitle, gaps, elsewhere, gapAction, proposals, onOpenProposal }: {
    title: string;
    subtitle: string;
    gaps: readonly DomainGap[];
    /** Gaps about other categories, shown beneath a category's own. */
    elsewhere?: readonly DomainGap[];
    gapAction: (gap: DomainGap) => GapAction;
    proposals: readonly ProposalSummary[];
    onOpenProposal: (id: string) => void;
}): import("react").JSX.Element;
