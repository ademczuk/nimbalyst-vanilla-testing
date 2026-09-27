import { type DomainGap, type DomainModel } from './ontologyDomain';
import { type GapAction, type OpenCategory } from './OntologyParts';
import { type ProposalSummary } from './OntologyRail';
export declare function OntologyMap({ model, selected, onSelect, onOpenGap }: {
    model: DomainModel;
    selected: string | null;
    onSelect: (id: string) => void;
    onOpenGap: (gapId: string) => void;
}): import("react").JSX.Element;
/** The category and its direct neighbors, for the top of a detail page. */
export declare function OntologyNeighborhood({ model, categoryId, onOpen, onOpenGap }: {
    model: DomainModel;
    categoryId: string;
    onOpen: OpenCategory;
    onOpenGap: (gapId: string) => void;
}): import("react").JSX.Element | null;
/** The map screen: the canvas and, beside it, an overview or the selected category. */
export declare function OntologyConceptMap({ model, selected, onSelect, gapAction, proposals, onOpenProposal, onOpenItem, onShowAll }: {
    model: DomainModel;
    selected: string | null;
    onSelect: (id: string | null) => void;
    gapAction: (gap: DomainGap) => GapAction;
    proposals: readonly ProposalSummary[];
    onOpenProposal: (id: string) => void;
    onOpenItem?: (itemId: string) => void;
    /** Opens the category's full detail in "What we track". */
    onShowAll: (id: string) => void;
}): import("react").JSX.Element;
