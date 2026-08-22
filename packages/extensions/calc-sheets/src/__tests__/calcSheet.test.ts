// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { evaluateCalcSheet } from '../evaluator';
import { parseCalcSheetDocument } from '../parser';

const DEMO_LINE_OUTPUTS = [
  '', '', '', '', '', '15.5 Mg', '9400 m / s', '', '', '',
  '9.80665 m / s^2', '25.6 Mg', '409.5 Mg', '282 s', '4 Mg',
  '107.5 Mg', '348 s', '', '', '0.5621 Gg', '152.6 Mg',
  '3605.79 m / s', '409.5 Mg', '', '', '127 Mg', '5794.21 m / s',
  '23.2512 Mg', '103.749 Mg', '3.75121 Mg', '96.5%', '', '', '',
  '2.76%', 'ASSERT OK', 'ASSERT OK', '',
];

describe('Calc Sheets parser and evaluator', () => {
  it('classifies constants vs formulas and evaluates dependencies', () => {
    const parsed = parseCalcSheetDocument([
      'price = 149 USD',
      'seats = 120',
      'mrr = price * seats -> currency(USD, 0)',
    ].join('\n'));

    const evaluated = evaluateCalcSheet(parsed.lines, parsed.frontmatter);
    const price = evaluated.bindings.get('price');
    const mrr = evaluated.bindings.get('mrr');

    expect(price?.classification).toBe('constant');
    expect(mrr?.classification).toBe('formula');
    expect(mrr?.formatted).toBe('$17,880');
  });

  it('parses frontmatter units and fx rates', () => {
    const parsed = parseCalcSheetDocument([
      '---',
      'baseCurrency: USD',
      'units:',
      '  - customer',
      'fx:',
      '  rates:',
      '    EUR: 1.08 USD',
      '---',
      '',
      'mrr = 100 USD',
      'mrr_eur = to(mrr, EUR) -> currency(EUR, 2)',
      'customers = 4 customer',
    ].join('\n'));

    const evaluated = evaluateCalcSheet(parsed.lines, parsed.frontmatter);
    expect(evaluated.bindings.get('mrr_eur')?.formatted).toBe('€92.59');
    expect(evaluated.bindings.get('customers')?.formatted).toContain('customer');
  });

  it('flags circular dependencies', () => {
    const parsed = parseCalcSheetDocument([
      'a = b + 1',
      'b = a + 1',
    ].join('\n'));

    const evaluated = evaluateCalcSheet(parsed.lines, parsed.frontmatter);
    expect(evaluated.bindings.get('a')?.error).toContain('Circular dependency');
    expect(evaluated.bindings.get('b')?.formatted).toBe('ERR');
  });

  it('evaluates assertions', () => {
    const parsed = parseCalcSheetDocument([
      'gross_profit = 80',
      'mrr = 100',
      'gross_margin = gross_profit / mrr -> percent(1)',
      'assert gross_profit / mrr > 0.5',
    ].join('\n'));

    const evaluated = evaluateCalcSheet(parsed.lines, parsed.frontmatter);
    expect(evaluated.bindings.get('gross_margin')?.formatted).toBe('80.0%');
    expect(evaluated.lineOutputs[3]).toBe('ASSERT OK');
  });

  it('supports markdown headings and comment lines in the demo sample', () => {
    const content = readFileSync(
      resolve(process.cwd(), 'packages/extensions/calc-sheets/samples/demo.calc.md'),
      'utf8',
    );

    const parsed = parseCalcSheetDocument(content);
    const evaluated = evaluateCalcSheet(parsed.lines, parsed.frontmatter);

    expect(parsed.lines.some((line) => line.kind === 'section')).toBe(true);
    expect(parsed.lines.some((line) => line.kind === 'comment')).toBe(true);
    expect(parsed.lines.some((line) => line.kind === 'unknown')).toBe(false);
    expect(evaluated.errorCount).toBe(0);
    expect(evaluated.lineOutputs).toEqual(DEMO_LINE_OUTPUTS);
    expect(evaluated.bindings.get('stage2_burn_fraction')?.formatted).toMatch(/%$/);

    const assertionIndexes = parsed.lines
      .filter((line) => line.kind === 'assert')
      .map((line) => line.index);
    expect(assertionIndexes.length).toBeGreaterThan(0);
    expect(assertionIndexes.every((index) => evaluated.lineOutputs[index] === 'ASSERT OK')).toBe(true);
  });

  it('treats narrative markdown as inert prose', () => {
    const parsed = parseCalcSheetDocument([
      'This worksheet explains the model.',
      '- Adjust the assumptions below.',
      '| Input | Value |',
      '> Results are illustrative.',
      '```text',
      '= 2,824 * ln(3.626)',
      '```',
    ].join('\n'));
    const evaluated = evaluateCalcSheet(parsed.lines, parsed.frontmatter);

    expect(parsed.lines.map((line) => line.kind)).toEqual(Array(7).fill('prose'));
    expect(evaluated.lineOutputs).toEqual(Array(7).fill(''));
    expect(evaluated.errorCount).toBe(0);
  });

  it('keeps malformed calc attempts and prose right-hand sides loud', () => {
    const parsed = parseCalcSheetDocument([
      'total =',
      'subtotal = 1 +',
      'dv = change in velocity (m/s)',
    ].join('\n'));
    const evaluated = evaluateCalcSheet(parsed.lines, parsed.frontmatter);

    expect(parsed.lines.map((line) => line.kind)).toEqual([
      'unknown',
      'binding',
      'binding',
    ]);
    expect(evaluated.lineOutputs).toEqual(['PARSE ERR', 'ERR', 'ERR']);
    expect(evaluated.errorCount).toBe(3);
  });

  it('evaluates ln as the natural logarithm', () => {
    const parsed = parseCalcSheetDocument('result = ln(1)');
    const evaluated = evaluateCalcSheet(parsed.lines, parsed.frontmatter);

    expect(evaluated.bindings.get('result')).toMatchObject({
      value: 0,
      formatted: '0',
      error: null,
    });
    expect(evaluated.errorCount).toBe(0);
  });
});
