/**
 * Small pieces every ontology view shares: a relationship line with its
 * completeness meter, a gap row with its Fix button, the members table and the
 * "Schema: how this is stored" disclosure.
 */
import { type ReactNode } from 'react';
import { type DomainCategory, type DomainGap, type DomainLine, type DomainModel, type DomainSchema, type MemberTable } from './ontologyDomain';
export type OpenCategory = (categoryId: string) => void;
/** One relationship: "Competitors sit in Markets", a meter, and "46 of 59". Dense is the card's version. */
export declare function OntologyLineRow({ category, line, targetName, dense, onOpenCategory }: {
    category: DomainCategory;
    line: DomainLine;
    targetName: string | null;
    dense?: boolean;
    onOpenCategory?: OpenCategory;
}): import("react").JSX.Element;
export type GapAction = {
    label: string;
    open: () => void;
};
export declare function OntologyGapRow({ gap, action }: {
    gap: DomainGap;
    action: GapAction;
}): import("react").JSX.Element;
export declare function OntologySchemaDisclosure({ schema }: {
    schema: DomainSchema | null;
}): import("react").JSX.Element | null;
export declare function OntologyMembersTable({ table, onOpenItem, limit }: {
    table: MemberTable;
    onOpenItem?: (itemId: string) => void;
    limit?: number;
}): import("react").JSX.Element;
export declare function groupDotClass(group: string): string;
export declare function categoryName(model: DomainModel, id: string | null): string | null;
/** "How they connect" for one category, with its note. */
export declare function CategoryLines({ model, category, onOpen, first }: {
    model: DomainModel;
    category: DomainCategory;
    onOpen: OpenCategory;
    first?: boolean;
}): ReactNode;
