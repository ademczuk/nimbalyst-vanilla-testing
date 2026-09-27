/**
 * The concept map: each category a box, each recorded relationship a line with
 * how many links it carries, and the links nobody records yet as dashed amber
 * lines that open a proposal. One click from "What we track". Also the small
 * neighborhood diagram at the top of a category's detail page.
 */
import { useState } from 'react';
import { formatCount, type DomainCategory, type DomainEdge, type DomainGap, type DomainModel } from './ontologyDomain';
import { CategoryLines, groupDotClass, OntologySchemaDisclosure, type GapAction, type OpenCategory } from './OntologyParts';
import { OntologyGapList, OntologyProposalList, type ProposalSummary } from './OntologyRail';

const NODE_W = 176;
const NODE_H = 62;
const MAP_W = 1060;

/**
 * Where each category sits: what we know about the world on the left (market,
 * then our product), what we do on the right (customers, then the work).
 */
const SLOTS: Record<string, [number, number]> = {
  markets: [100, 90], competitors: [390, 90],
  organizations: [100, 290], us: [390, 300],
  technologies: [100, 520], capabilities: [390, 520],
  personas: [700, 80], people: [960, 80],
  customers: [700, 240], plans: [960, 240],
  features: [960, 390], areas: [700, 480],
  bugs: [960, 560], decisions: [700, 640],
  goals: [960, 710],
};
/** Curves for edges that would otherwise run through a box, and where their label sits. */
const BENDS: Record<string, [number, number]> = {
  'competitors>capabilities': [-300, 0.25],
  'us>technologies': [-30, 0.5],
  'plans>goals': [-60, 0.5],
};

/**
 * Edges the map leaves to the Nimbalyst card: with us sitting between the
 * market boxes they would cross the competitor lines, and each is one link.
 */
const MAP_HIDDEN: ReadonlySet<string> = new Set(['us>markets', 'us>organizations']);

function edgeCount(edge: DomainEdge, fromUs: boolean): string {
  if (edge.state === 'missing') return '';
  if (!fromUs && edge.have < edge.total) return `${formatCount(edge.have)} of ${formatCount(edge.total)}`;
  return formatCount(edge.links);
}

function clip(cx: number, cy: number, tx: number, ty: number, w: number, h: number): [number, number] {
  const dx = tx - cx;
  const dy = ty - cy;
  const scale = Math.min((w / 2 + 4) / Math.abs(dx || 1e-6), (h / 2 + 4) / Math.abs(dy || 1e-6));
  return [cx + dx * scale, cy + dy * scale];
}

function EdgeLabel({ x, y, text, count, onClick }: { x: number; y: number; text: string; count: string; onClick?: () => void }) {
  const width = (text.length + (count ? count.length + 3 : 0)) * 6.1 + 16;
  return (
    <g className="ontology-edge-label" onClick={onClick}>
      <rect x={x - width / 2} y={y - 10} width={width} height={20} rx={10} />
      <text x={x} y={y + 4} textAnchor="middle">{text}{count && <tspan> {count}</tspan>}</text>
    </g>
  );
}

function ArrowDefs({ id }: { id: string }) {
  return (
    <defs>
      <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
        <path className="ontology-arrow" d="M0,0 L10,5 L0,10 z" />
      </marker>
    </defs>
  );
}

function nodeCountLabel(category: DomainCategory): string {
  if (category.ghost) return 'not tracked';
  if (category.us) return 'us';
  return `${formatCount(category.count)}${category.countLabel ? ` ${category.countLabel}` : ''}`;
}

export function OntologyMap({ model, selected, onSelect, onOpenGap }: {
  model: DomainModel;
  selected: string | null;
  onSelect: (id: string) => void;
  onOpenGap: (gapId: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const focus = hover ?? selected;
  const placed = model.categories.filter((category) => SLOTS[category.id]);
  const byId = new Map(placed.map((category) => [category.id, category]));
  const edges = model.edges.filter((edge) => byId.has(edge.from) && byId.has(edge.to) && !MAP_HIDDEN.has(`${edge.from}>${edge.to}`));
  // Crop to the boxes present: a room tracking two things should not sit at the bottom of an empty canvas.
  const ys = placed.map((category) => SLOTS[category.id]![1]);
  const top = ys.length ? Math.max(0, Math.min(...ys) - NODE_H / 2 - 54) : 0;
  const height = (ys.length ? Math.max(...ys) : 0) + NODE_H / 2 + 24 - top;
  const lit = new Set<string>();
  if (focus) {
    lit.add(focus);
    for (const edge of edges) {
      if (edge.from === focus || edge.to === focus) {
        lit.add(edge.id);
        lit.add(edge.from);
        lit.add(edge.to);
      }
    }
  }
  const warned = new Set(model.gaps.filter((gap) => gap.tone === 'gap').flatMap((gap) => gap.categoryIds.slice(0, 1)));
  return (
    <svg className="ontology-map-svg" viewBox={`0 ${top} ${MAP_W} ${height}`} data-focus={focus ? 'true' : 'false'} role="img" aria-label="What we track and how it connects">
      <ArrowDefs id="ontology-arrow" />
      <line x1={560} y1={top + 24} x2={560} y2={top + height - 20} stroke="currentColor" strokeOpacity={0.15} strokeDasharray="2 5" />
      <text className="ontology-region" x={24} y={top + 34}>WHAT WE KNOW ABOUT THE WORLD</text>
      <text className="ontology-region" x={585} y={top + 34}>WHAT WE DO</text>
      {edges.map((edge) => {
        const [x1, y1] = SLOTS[edge.from]!;
        const [x2, y2] = SLOTS[edge.to]!;
        const [bend, at] = BENDS[`${edge.from}>${edge.to}`] ?? [0, 0.5];
        const length = Math.hypot(x2 - x1, y2 - y1) || 1;
        const cx = (x1 + x2) / 2 + (-(y2 - y1) / length) * bend;
        const cy = (y1 + y2) / 2 + ((x2 - x1) / length) * bend;
        const [sx, sy] = clip(x1, y1, cx, cy, NODE_W, NODE_H);
        const [ex, ey] = clip(x2, y2, cx, cy, NODE_W, NODE_H);
        const lx = (1 - at) ** 2 * sx + 2 * at * (1 - at) * cx + at * at * ex;
        const ly = (1 - at) ** 2 * sy + 2 * at * (1 - at) * cy + at * at * ey;
        const width = edge.state === 'missing' ? 1.6 : edge.state === 'weak' ? 1.3 : Math.min(1.2 + Math.log10(edge.links + 1) * 1.3, 4.2);
        const missing = edge.state === 'missing';
        return (
          <g key={edge.id} className="ontology-edge" data-state={edge.state} data-lit={lit.has(edge.id) ? 'true' : 'false'}>
            <path d={`M${sx},${sy} Q${cx},${cy} ${ex},${ey}`} strokeWidth={width} markerEnd={missing ? undefined : 'url(#ontology-arrow)'} />
            <EdgeLabel
              x={lx}
              y={ly}
              text={missing ? `${edge.verb}  +` : edge.verb}
              count={edgeCount(edge, byId.get(edge.from)?.us ?? false)}
              onClick={missing && edge.gapId ? () => onOpenGap(edge.gapId!) : undefined}
            />
          </g>
        );
      })}
      {placed.map((category) => {
        const [x, y] = SLOTS[category.id]!;
        const left = x - NODE_W / 2;
        const top = y - NODE_H / 2;
        const example = category.ghost ? `Add ${category.name.toLowerCase()}  +` : category.example;
        return (
          <g
            key={category.id}
            className="ontology-node"
            data-category={category.id}
            data-selected={selected === category.id ? 'true' : 'false'}
            data-us={category.us ? 'true' : 'false'}
            data-ghost={category.ghost ? 'true' : 'false'}
            data-lit={lit.has(category.id) ? 'true' : 'false'}
            onMouseEnter={() => setHover(category.id)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onSelect(category.id)}
          >
            <rect className="ontology-node-box" x={left} y={top} width={NODE_W} height={NODE_H} rx={10} />
            {!category.ghost && <rect className={`ontology-node-accent ontology-node-accent-${category.group}`} x={left} y={top + 12} width={3} height={NODE_H - 24} rx={1.5} />}
            <text className="ontology-node-title" x={left + 14} y={top + 25}>{category.name.length > 16 ? `${category.name.slice(0, 15)}…` : category.name}</text>
            <text className="ontology-node-count" x={left + NODE_W - 12} y={top + 25} textAnchor="end">{nodeCountLabel(category)}</text>
            <text className="ontology-node-example" x={left + 14} y={top + 45}>{example.length > 30 ? `${example.slice(0, 29)}…` : example}</text>
            {warned.has(category.id) && <circle cx={left + NODE_W - 4} cy={top + 2} r={4} className="ontology-node-warn" />}
          </g>
        );
      })}
    </svg>
  );
}

/** The category and its direct neighbors, for the top of a detail page. */
export function OntologyNeighborhood({ model, categoryId, onOpen, onOpenGap }: {
  model: DomainModel;
  categoryId: string;
  onOpen: OpenCategory;
  onOpenGap: (gapId: string) => void;
}) {
  const edges = model.edges.filter((edge) => edge.from === categoryId || edge.to === categoryId);
  const byId = new Map(model.categories.map((category) => [category.id, category]));
  const others = [...new Set(edges.map((edge) => (edge.from === categoryId ? edge.to : edge.from)))].filter((id) => byId.has(id));
  if (!others.length) return null;
  const W = 720;
  const H = 300;
  const boxW = 140;
  const boxH = 44;
  const positions = new Map<string, [number, number]>([[categoryId, [W / 2, H / 2]]]);
  others.forEach((id, index) => {
    const step = (2 * Math.PI) / others.length;
    const angle = others.length === 1 ? 0 : -Math.PI / 2 + index * step;
    positions.set(id, [W / 2 + Math.cos(angle) * 262, H / 2 + Math.sin(angle) * 105]);
  });
  return (
    <div className="ontology-canvas ontology-neighborhood">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Directly connected categories">
        <ArrowDefs id="ontology-arrow-small" />
        {edges.filter((edge) => positions.has(edge.from) && positions.has(edge.to)).map((edge) => {
          const [x1, y1] = positions.get(edge.from)!;
          const [x2, y2] = positions.get(edge.to)!;
          const [sx, sy] = clip(x1, y1, x2, y2, boxW, boxH);
          const [ex, ey] = clip(x2, y2, x1, y1, boxW, boxH);
          const missing = edge.state === 'missing';
          return (
            <g key={edge.id} className="ontology-edge" data-state={edge.state}>
              <path d={`M${sx},${sy} L${ex},${ey}`} strokeWidth={1.6} markerEnd={missing ? undefined : 'url(#ontology-arrow-small)'} />
              <EdgeLabel
                x={(sx + ex) / 2}
                y={(sy + ey) / 2}
                text={missing ? `${edge.verb}  +` : edge.verb}
                count={edgeCount(edge, byId.get(edge.from)?.us ?? false)}
                onClick={missing && edge.gapId ? () => onOpenGap(edge.gapId!) : undefined}
              />
            </g>
          );
        })}
        {[...positions.entries()].map(([id, [x, y]]) => {
          const category = byId.get(id)!;
          const self = id === categoryId;
          return (
            <g
              key={id}
              className="ontology-node"
              data-selected={self ? 'true' : 'false'}
              data-us={category.us ? 'true' : 'false'}
              data-ghost={category.ghost ? 'true' : 'false'}
              onClick={self ? undefined : () => onOpen(id)}
            >
              <rect className="ontology-node-box" x={x - boxW / 2} y={y - boxH / 2} width={boxW} height={boxH} rx={9} />
              <text className="ontology-node-title" x={x} y={y - 2} textAnchor="middle">{category.name}</text>
              <text className="ontology-node-example" x={x} y={y + 14} textAnchor="middle">{nodeCountLabel(category)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const PANEL_GAPS = 7;
const PANEL_MEMBERS = 8;

/** The map screen: the canvas and, beside it, an overview or the selected category. */
export function OntologyConceptMap({ model, selected, onSelect, gapAction, proposals, onOpenProposal, onOpenItem, onShowAll }: {
  model: DomainModel;
  selected: string | null;
  onSelect: (id: string | null) => void;
  gapAction: (gap: DomainGap) => GapAction;
  proposals: readonly ProposalSummary[];
  onOpenProposal: (id: string) => void;
  onOpenItem?: (itemId: string) => void;
  /** Opens the category's full detail in "What we track". */
  onShowAll: (id: string) => void;
}) {
  const openGap = (gapId: string) => {
    const gap = model.gaps.find((entry) => entry.id === gapId);
    if (gap) gapAction(gap).open();
  };
  const category = selected ? model.categories.find((entry) => entry.id === selected) ?? null : null;
  const select = (id: string) => {
    const target = model.categories.find((entry) => entry.id === id);
    if (target?.ghost) {
      const gap = model.gaps.find((entry) => target.gapIds.includes(entry.id));
      if (gap) gapAction(gap).open();
    }
    onSelect(id);
  };
  return (
    <div className="ontology-map">
      <div className="ontology-map-main">
        <h1>What we track, and how it connects</h1>
        <p className="ontology-map-sub">
          Each box is something your team keeps track of. Lines are relationships people or agents have recorded, with how many. Dashed amber lines are connections you probably want but do not record yet.
        </p>
        <div className="ontology-map-key">
          <span><span className="ontology-dot ontology-dot-market" />Market</span>
          <span><span className="ontology-dot ontology-dot-product" />Our product</span>
          <span><span className="ontology-dot ontology-dot-customers" />Customers</span>
          <span><span className="ontology-dot ontology-dot-work" />Work</span>
          <span><span className="ontology-key-line" data-state="recorded" />recorded</span>
          <span><span className="ontology-key-line" data-state="weak" />possible, rarely used</span>
          <span><span className="ontology-key-line" data-state="missing" />missing</span>
        </div>
        <div className="ontology-canvas">
          <OntologyMap model={model} selected={selected} onSelect={select} onOpenGap={openGap} />
        </div>
        {model.also.length > 0 && (
          <div className="ontology-also ontology-also-plain">
            <span>Also tracked</span>
            {model.also.map((chip) => <span key={chip.id} className="ontology-chip">{chip.name} <i>{formatCount(chip.count)}</i></span>)}
          </div>
        )}
      </div>
      <aside className="ontology-map-panel">
        {category ? (
          <MapCategoryPanel model={model} category={category} onBack={() => onSelect(null)} onOpen={select} gapAction={gapAction} onOpenItem={onOpenItem} onShowAll={onShowAll} />
        ) : (
          <>
            <div className="ontology-kicker">Overview</div>
            <div className="ontology-title"><h2 className="ontology-panel-title">At a glance</h2></div>
            <p className="ontology-blurb">
              {formatCount(model.meta.pages)} wiki pages and {formatCount(model.meta.statements)} statements, plus the work trackers. Hover a box to trace its connections; click it for members and details.
            </p>
            <div className="ontology-label">Worth fixing <span>{model.gaps.length}</span></div>
            {model.gaps.length ? <OntologyGapList gaps={model.gaps} gapAction={gapAction} limit={PANEL_GAPS} /> : <div className="ontology-empty">Nothing to fix.</div>}
            <div className="ontology-label ontology-label-spaced">Proposals</div>
            <OntologyProposalList proposals={proposals} onOpenProposal={onOpenProposal} />
          </>
        )}
      </aside>
    </div>
  );
}

function MapCategoryPanel({ model, category, onBack, onOpen, gapAction, onOpenItem, onShowAll }: {
  model: DomainModel;
  category: DomainCategory;
  onBack: () => void;
  onOpen: OpenCategory;
  gapAction: (gap: DomainGap) => GapAction;
  onOpenItem?: (itemId: string) => void;
  onShowAll: (id: string) => void;
}) {
  const group = model.groups.find((entry) => entry.id === category.group);
  const gaps = model.gaps.filter((gap) => category.gapIds.includes(gap.id));
  const table = { ...category.table, rows: category.table.rows.slice(0, PANEL_MEMBERS) };
  return (
    <div className="ontology-map-category" data-category={category.id}>
      <button type="button" className="ontology-back" onClick={onBack}>&larr; All categories</button>
      <div className="ontology-kicker"><span className={groupDotClass(category.group)} />{group?.label}</div>
      <div className="ontology-title">
        <h2 className="ontology-panel-title">{category.name}</h2>
        {!category.us && !category.ghost && <span>{formatCount(category.count)}</span>}
      </div>
      <p className="ontology-blurb">{category.blurb}</p>
      {category.ghost && gaps[0] && (
        <button type="button" className="ontology-button ontology-button-primary" onClick={() => gapAction(gaps[0]!).open()}>
          Propose tracking {category.name.toLowerCase()}
        </button>
      )}
      <CategoryLines model={model} category={category} onOpen={onOpen} />
      {gaps.length > 0 && (
        <>
          <div className="ontology-label">Worth fixing</div>
          <OntologyGapList gaps={gaps} gapAction={gapAction} />
        </>
      )}
      {category.table.rows.length > 0 && (
        <>
          <div className="ontology-label">{category.us ? 'Recorded about us' : 'Members'}</div>
          {/* The panel is too narrow for the table's columns: a name and the rest of its row. */}
          {table.rows.map((row) => {
            const [name, ...rest] = row.cells;
            const detail = rest.filter((cell) => cell.tone !== 'faint').map((cell) => cell.text).join(' · ');
            return (
              <div key={row.id} className="ontology-member-line" data-tone={rest.some((cell) => cell.tone === 'warn') ? 'warn' : undefined}>
                {onOpenItem && !category.us
                  ? <button type="button" className="ontology-link" onClick={() => onOpenItem(row.id)}>{name?.text}</button>
                  : <span>{name?.text}</span>}
                <span title={detail}>{detail}</span>
              </div>
            );
          })}
          {!category.us && category.table.rows.length > PANEL_MEMBERS && (
            <button type="button" className="ontology-link ontology-more" onClick={() => onShowAll(category.id)}>
              See all {formatCount(category.table.rows.length)}
            </button>
          )}
        </>
      )}
      <OntologySchemaDisclosure schema={category.schema} />
    </div>
  );
}
