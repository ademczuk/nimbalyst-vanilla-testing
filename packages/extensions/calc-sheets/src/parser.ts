import { splitCalcSheetDocument } from './frontmatter';
import { classifyCalcSheetLine } from './lineClassifier';
import type { CalcSheetLine, ParsedCalcSheetDocument } from './types';

function parseLine(raw: string, index: number): CalcSheetLine {
  const classified = classifyCalcSheetLine(raw);

  if (classified.kind === 'section') {
    return {
      index,
      raw,
      kind: 'section',
      sectionTitle: classified.sectionTitle,
    };
  }
  if (classified.kind === 'assert' && classified.assertionExpression) {
    return {
      index,
      raw,
      kind: 'assert',
      assertion: { expression: classified.assertionExpression },
    };
  }
  if (classified.kind === 'binding' && classified.binding) {
    return {
      index,
      raw,
      kind: 'binding',
      binding: classified.binding,
    };
  }
  if (classified.kind === 'unknown') {
    return {
      index,
      raw,
      kind: 'unknown',
      parseError: 'Unrecognized line',
    };
  }
  return { index, raw, kind: classified.kind };
}

export function parseCalcSheetDocument(content: string): ParsedCalcSheetDocument {
  const base = splitCalcSheetDocument(content);
  const lines = base.body
    .split(/\r?\n/)
    .map((line, index) => parseLine(line, index));
  return {
    ...base,
    lines,
  };
}
