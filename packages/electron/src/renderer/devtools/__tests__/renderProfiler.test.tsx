// @vitest-environment jsdom
/**
 * The profiler reads React's internal fiber flags. If a React upgrade changes
 * `PerformedWork`, the work-tag numbering, or the DevTools hook contract, this
 * file goes red — which is the whole point. Without it the profiler would just
 * start reporting zero renders and every budget test would pass vacuously.
 */

// MUST be first: the DevTools hook shim has to exist before react-dom loads.
import { measureRenders } from '../renderBudget';

import React, { useState } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => cleanup());

function Leaf({ label }: { label: string }) {
  return <span data-testid="leaf">{label}</span>;
}

const MemoLeaf = React.memo(function MemoLeaf({ label }: { label: string }) {
  return <span data-testid="memo-leaf">{label}</span>;
});

describe('renderProfiler', () => {
  it('counts a component render per commit and names it', async () => {
    let bump: () => void = () => {};
    function Parent() {
      const [n, setN] = useState(0);
      bump = () => setN(v => v + 1);
      return <Leaf label={`n=${n}`} />;
    }

    render(<Parent />);

    const budget = await measureRenders(async () => {
      await act(async () => { bump(); });
      await act(async () => { bump(); });
    });

    expect(budget.rendersOf('Parent')).toBe(2);
    expect(budget.rendersOf('Leaf')).toBe(2);
    expect(budget.commits).toBe(2);
    expect(screen.getByTestId('leaf').textContent).toBe('n=2');
  });

  it('does not count a memoized child whose props did not change', async () => {
    let bump: () => void = () => {};
    function Parent() {
      const [n, setN] = useState(0);
      bump = () => setN(v => v + 1);
      return (
        <div>
          <span>{n}</span>
          <MemoLeaf label="constant" />
        </div>
      );
    }

    render(<Parent />);

    const budget = await measureRenders(async () => {
      await act(async () => { bump(); });
    });

    expect(budget.rendersOf('Parent')).toBe(1);
    expect(budget.rendersOf('MemoLeaf')).toBe(0);
  });

  // The finding that matters: a child re-renders only because the parent handed
  // it a freshly-built object/lambda that holds exactly the same thing.
  it('diagnoses an unstable prop identity', async () => {
    let bump: () => void = () => {};
    function Parent() {
      const [n, setN] = useState(0);
      bump = () => setN(v => v + 1);
      // `items` and `onPick` are rebuilt every render but never actually change.
      return <Child tick={0} items={['a', 'b']} onPick={() => {}} hidden={n < 0} />;
    }
    function Child(_props: { tick: number; items: string[]; onPick: () => void; hidden: boolean }) {
      return <span data-testid="child" />;
    }

    render(<Parent />);

    const budget = await measureRenders(async () => {
      await act(async () => { bump(); });
    });

    expect(budget.rendersOf('Child')).toBe(1);
    const reasons = Object.keys(budget.snapshot.components.find(c => c.name === 'Child')!.reasons);
    expect(reasons.join(' ')).toContain('unstable prop identity');
    expect(reasons.join(' ')).toContain('items');
    expect(reasons.join(' ')).toContain('onPick');
  });

  it('reports a real prop change as a change, not an unstable identity', async () => {
    let bump: () => void = () => {};
    function Parent() {
      const [n, setN] = useState(0);
      bump = () => setN(v => v + 1);
      return <Child tick={n} />;
    }
    function Child(_props: { tick: number }) {
      return <span />;
    }

    render(<Parent />);

    const budget = await measureRenders(async () => {
      await act(async () => { bump(); });
    });

    const reasons = Object.keys(budget.snapshot.components.find(c => c.name === 'Child')!.reasons);
    expect(reasons.join(' ')).toContain('props changed: tick');
  });

  /**
   * A subtree React skipped is the previous commit's fibers, untouched: they
   * still carry the `PerformedWork` bit from whenever they last rendered, and
   * their `return` still points at the previous tree's parent. Reading either
   * naively made a sidebar-row budget report 1 or 3 renders for the same click,
   * depending only on what had rendered before it — a stale bit re-counted, and
   * a walk that climbed out of the committed tree and never came back.
   */
  it('reads only the committed tree, and only this commit', async () => {
    let bumpBranch: () => void = () => {};
    let bumpRoot: () => void = () => {};

    function BranchLeaf({ n }: { n: number }) {
      return <span data-testid="branch-leaf">{n}</span>;
    }
    const Branch = React.memo(function Branch() {
      const [n, setN] = useState(0);
      bumpBranch = () => setN(v => v + 1);
      return <BranchLeaf n={n} />;
    });
    // Deliberately after the branch: a walk that climbs out through the skipped
    // subtree lands on the previous tree's siblings and never reaches this.
    function Tail({ tick }: { tick: number }) {
      return <span data-testid="tail">{tick}</span>;
    }
    function Root() {
      const [tick, setTick] = useState(0);
      bumpRoot = () => setTick(v => v + 1);
      return <div><Branch /><Tail tick={tick} /></div>;
    }

    render(<Root />);
    // Renders the branch once, outside the budget, so its fibers carry the bit.
    await act(async () => { bumpBranch(); });

    const budget = await measureRenders(async () => {
      await act(async () => { bumpRoot(); });
    });

    expect(budget.rendersOf('Root'), budget.report()).toBe(1);
    expect(budget.rendersOf('Tail'), budget.report()).toBe(1);
    expect(budget.rendersOf('Branch'), budget.report()).toBe(0);
    expect(budget.rendersOf('BranchLeaf'), budget.report()).toBe(0);
    expect(screen.getByTestId('tail').textContent).toBe('1');
  });

  it('produces a readable report for a failing budget', async () => {
    let bump: () => void = () => {};
    function Parent() {
      const [n, setN] = useState(0);
      bump = () => setN(v => v + 1);
      return <Leaf label={String(n)} />;
    }
    render(<Parent />);

    const budget = await measureRenders(async () => {
      await act(async () => { bump(); });
    });

    expect(budget.report()).toContain('Leaf');
    expect(budget.report()).toMatch(/\d+ renders across \d+ commits/);
  });
});
