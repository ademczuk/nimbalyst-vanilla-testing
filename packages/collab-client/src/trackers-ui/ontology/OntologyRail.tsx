/**
 * "Worth fixing" and "Proposals": the gaps the model found, each opening a
 * proposal, and the ontology proposals already on record.
 */
import { useState } from 'react';
import type { DomainGap } from './ontologyDomain';
import { OntologyGapRow, type GapAction } from './OntologyParts';

export interface ProposalSummary {
  id: string;
  title: string;
  status: string;
}

const STATUS_LABELS: Record<string, string> = {
  proposed: 'Proposed',
  accepted: 'Accepted',
  applied: 'Applied',
  rejected: 'Rejected',
  undone: 'Undone',
};

export function proposalStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function OntologyGapList({ gaps, gapAction, limit }: {
  gaps: readonly DomainGap[];
  gapAction: (gap: DomainGap) => GapAction;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = limit && !expanded ? gaps.slice(0, limit) : gaps;
  return (
    <>
      {shown.map((gap) => <OntologyGapRow key={gap.id} gap={gap} action={gapAction(gap)} />)}
      {gaps.length > shown.length && (
        <button type="button" className="ontology-link ontology-more" onClick={() => setExpanded(true)}>
          Show {gaps.length - shown.length} more
        </button>
      )}
    </>
  );
}

export function OntologyProposalList({ proposals, onOpenProposal }: {
  proposals: readonly ProposalSummary[];
  onOpenProposal: (id: string) => void;
}) {
  if (!proposals.length) {
    return <div className="ontology-empty">None yet. Rejected proposals are kept so the agent does not suggest them again.</div>;
  }
  return (
    <div className="ontology-proposal-list">
      {proposals.map((proposal) => (
        <button key={proposal.id} type="button" className="ontology-proposal-row" onClick={() => onOpenProposal(proposal.id)}>
          <span className="ontology-proposal-row-title">{proposal.title}</span>
          <span className="ontology-status" data-status={proposal.status}>{proposalStatusLabel(proposal.status)}</span>
        </button>
      ))}
    </div>
  );
}

/** The right-hand rail of "What we track". */
export function OntologyRail({ title, subtitle, gaps, elsewhere, gapAction, proposals, onOpenProposal }: {
  title: string;
  subtitle: string;
  gaps: readonly DomainGap[];
  /** Gaps about other categories, shown beneath a category's own. */
  elsewhere?: readonly DomainGap[];
  gapAction: (gap: DomainGap) => GapAction;
  proposals: readonly ProposalSummary[];
  onOpenProposal: (id: string) => void;
}) {
  return (
    <aside className="ontology-rail">
      <h4>{title}</h4>
      <p className="ontology-rail-sub">{subtitle}</p>
      <OntologyGapList gaps={gaps} gapAction={gapAction} />
      {elsewhere && elsewhere.length > 0 && (
        <>
          <div className="ontology-label">Elsewhere</div>
          <OntologyGapList gaps={elsewhere} gapAction={gapAction} limit={3} />
        </>
      )}
      <div className="ontology-label ontology-label-spaced">Proposals</div>
      <OntologyProposalList proposals={proposals} onOpenProposal={onOpenProposal} />
    </aside>
  );
}
