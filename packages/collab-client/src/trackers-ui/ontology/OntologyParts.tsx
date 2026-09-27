/**
 * Small pieces every ontology view shares: a relationship line with its
 * completeness meter, a gap row with its Fix button, the members table and the
 * "Schema: how this is stored" disclosure.
 */
import { useState, type ReactNode } from 'react';
import { formatCount, singularVerb, type DomainCategory, type DomainGap, type DomainLine, type DomainModel, type DomainSchema, type MemberTable } from './ontologyDomain';

export type OpenCategory = (categoryId: string) => void;

function Meter({ line }: { line: DomainLine }) {
  return (
    <div className="ontology-meter" data-state={line.state}>
      <i style={{ width: `${Math.round(line.rate * 100)}%` }} />
    </div>
  );
}

/** Category names read lowercase mid-sentence ("sit in markets"); the product's own name keeps its case. */
function targetLabel(line: DomainLine, name: string): string {
  return line.targetId === 'us' ? name : name.toLowerCase();
}

function lineValue(category: DomainCategory, line: DomainLine, targetName: string): string {
  if (line.state === 'untracked') return 'not recorded';
  if (category.us) return `${formatCount(line.links)} ${targetLabel(line, targetName)}`;
  if (line.have === line.total) return `all ${formatCount(line.total)}`;
  return `${formatCount(line.have)} of ${formatCount(line.total)}`;
}

/** One relationship: "Competitors sit in Markets", a meter, and "46 of 59". Dense is the card's version. */
export function OntologyLineRow({ category, line, targetName, dense, onOpenCategory }: {
  category: DomainCategory;
  line: DomainLine;
  targetName: string | null;
  dense?: boolean;
  onOpenCategory?: OpenCategory;
}) {
  if (dense) {
    const value = line.state === 'untracked' ? 'not yet' : category.us ? formatCount(line.links) : `${Math.round(line.rate * 100)}%`;
    return (
      <div className="ontology-line-dense">
        <span>{category.us ? singularVerb(line.verb) : line.verb}{targetName && <> <b>{targetLabel(line, targetName)}</b></>}</span>
        <Meter line={line} />
        <span className="ontology-line-value" data-state={line.state}>{value}</span>
      </div>
    );
  }
  const verb = category.us ? singularVerb(line.verb) : line.verb;
  return (
    <div className="ontology-line" title={`Recorded as ${line.via}`}>
      <div className="ontology-line-text">
        {category.name} {verb}{' '}
        {targetName && line.targetId && (onOpenCategory
          ? <button type="button" className="ontology-line-target" onClick={() => onOpenCategory(line.targetId!)}>{targetLabel(line, targetName)}</button>
          : <b>{targetLabel(line, targetName)}</b>)}
      </div>
      <Meter line={line} />
      <div className="ontology-line-value" data-state={line.state}>{lineValue(category, line, targetName ?? '')}</div>
    </div>
  );
}

export type GapAction = { label: string; open: () => void };

export function OntologyGapRow({ gap, action }: { gap: DomainGap; action: GapAction }) {
  return (
    <div className="ontology-gap" data-tone={gap.tone} data-gap={gap.id}>
      <span className="ontology-dot" />
      <div>
        <div className="ontology-gap-title">{gap.title}</div>
        <div className="ontology-gap-detail">{gap.detail}</div>
      </div>
      <button type="button" className="ontology-button ontology-button-sm" onClick={action.open}>{action.label}</button>
    </div>
  );
}

export function OntologySchemaDisclosure({ schema }: { schema: DomainSchema | null }) {
  if (!schema) return null;
  return (
    <details className="ontology-schema">
      <summary>Schema: how this is stored</summary>
      <div className="ontology-schema-body">
        <p className="ontology-schema-stored">
          {schema.stored.map((part, index) => (part.code ? <code key={index}>{part.text}</code> : <span key={index}>{part.text}</span>))}
        </p>
        {schema.rows.map((row) => {
          const rate = row.filled === null || row.total === 0 ? 0 : row.filled / row.total;
          const state = row.filled === null ? 'partial' : rate >= 0.98 ? 'full' : rate < 0.6 ? 'low' : 'partial';
          return (
            <div key={row.label} className="ontology-schema-row">
              <span>{row.label}{row.retired && <span className="ontology-schema-retired">being retired</span>}</span>
              {row.filled === null ? <span /> : <div className="ontology-meter" data-state={state}><i style={{ width: `${Math.round(rate * 100)}%` }} /></div>}
              <span>{row.filled === null ? 'in use' : `${formatCount(row.filled)}/${formatCount(row.total)}`}</span>
            </div>
          );
        })}
      </div>
    </details>
  );
}

const TABLE_PAGE = 12;

export function OntologyMembersTable({ table, onOpenItem, limit = TABLE_PAGE }: {
  table: MemberTable;
  onOpenItem?: (itemId: string) => void;
  limit?: number;
}) {
  const [shown, setShown] = useState(limit);
  if (!table.rows.length) return <p className="ontology-empty">Nothing recorded yet.</p>;
  const rows = table.rows.slice(0, shown);
  // The "us" table lists what is recorded about us, not items, so its rows open nothing.
  const openable = Boolean(onOpenItem) && table.columns[0] !== 'Recorded';
  return (
    <>
      <table className="ontology-members">
        <thead><tr>{table.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {row.cells.map((cell, index) => (
                <td key={index} data-tone={cell.tone}>
                  {cell.threat ? <span className="ontology-threat" data-threat={cell.threat}>{cell.text}</span>
                    : index === 0 && openable ? <button type="button" onClick={() => onOpenItem!(row.id)}>{cell.text}</button>
                      : cell.text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.rows.length > shown && (
        <button type="button" className="ontology-link ontology-more" onClick={() => setShown(table.rows.length)}>
          Show {formatCount(table.rows.length - shown)} more
        </button>
      )}
    </>
  );
}

export function groupDotClass(group: string): string {
  return `ontology-dot ontology-dot-${group}`;
}

export function categoryName(model: DomainModel, id: string | null): string | null {
  return id ? model.categories.find((category) => category.id === id)?.name ?? id : null;
}

/** "How they connect" for one category, with its note. */
export function CategoryLines({ model, category, onOpen, first }: { model: DomainModel; category: DomainCategory; onOpen: OpenCategory; first?: boolean }): ReactNode {
  if (!category.lines.length && !category.note) return null;
  return (
    <>
      <div className={`ontology-label${first ? ' ontology-label-first' : ''}`}>How they connect</div>
      {category.lines.map((line) => (
        <OntologyLineRow key={line.id} category={category} line={line} targetName={categoryName(model, line.targetId)} onOpenCategory={onOpen} />
      ))}
      {category.note && <div className="ontology-note">{category.note}</div>}
    </>
  );
}

