import { type DomainCategory, type DomainGap, type DomainModel } from './ontologyDomain';
import { type GapAction, type OpenCategory } from './OntologyParts';
import { type ProposalSummary } from './OntologyRail';
export interface OntologyViewProps {
    model: DomainModel;
    gapAction: (gap: DomainGap) => GapAction;
    proposals: readonly ProposalSummary[];
    onOpenProposal: (id: string) => void;
    onOpenItem?: (itemId: string) => void;
}
export declare function OntologySummary({ model, onOpen, now }: {
    model: DomainModel;
    onOpen: OpenCategory;
    now: number;
}): import("react").JSX.Element;
export declare function OntologyOverview({ model, onOpen, gapAction, now }: {
    model: DomainModel;
    onOpen: OpenCategory;
    gapAction: (gap: DomainGap) => GapAction;
    now: number;
}): import("react").JSX.Element;
export declare function OntologyCategoryDetail({ model, category, onOpen, onBack, onOpenItem, onOpenGap, backLabel }: {
    model: DomainModel;
    category: DomainCategory;
    onOpen: OpenCategory;
    onBack: () => void;
    onOpenItem?: (itemId: string) => void;
    onOpenGap: (gapId: string) => void;
    backLabel: string;
}): import("react").JSX.Element;
/** The whole "What we track" screen: overview or one category, with the gaps rail beside it. */
export declare function OntologyWhatWeTrack({ model, gapAction, proposals, onOpenProposal, onOpenItem, selected, onSelect, now }: OntologyViewProps & {
    selected: string | null;
    onSelect: (categoryId: string | null) => void;
    now: number;
}): import("react").JSX.Element;
