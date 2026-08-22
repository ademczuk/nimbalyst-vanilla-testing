import type { CalcFormatterSpec, CalcSheetBinding, CalcSheetLineKind } from './types';

export interface ClassifiedCalcSheetLine {
  kind: CalcSheetLineKind;
  match: RegExpMatchArray | null;
  calcAttempt?: 'assert' | 'binding';
  sectionTitle?: string;
  assertionExpression?: string;
  binding?: CalcSheetBinding;
}

function splitFormatter(raw: string): {
  expression: string;
  formatter: string | null;
} {
  let depth = 0;
  let inString = false;

  for (let index = 0; index < raw.length - 1; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];
    if (char === '"' && raw[index - 1] !== '\\') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '(' || char === '[' || char === '{') depth += 1;
    if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1);
    if (depth === 0 && char === '-' && next === '>') {
      return {
        expression: raw.slice(0, index).trim(),
        formatter: raw.slice(index + 2).trim(),
      };
    }
  }

  return {
    expression: raw.trim(),
    formatter: null,
  };
}

function splitArguments(raw: string): string[] {
  if (!raw.trim()) return [];
  const args: string[] = [];
  let current = '';
  let depth = 0;
  let inString = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '"' && raw[index - 1] !== '\\') {
      inString = !inString;
      current += char;
      continue;
    }
    if (!inString && (char === '(' || char === '[' || char === '{')) {
      depth += 1;
      current += char;
      continue;
    }
    if (!inString && (char === ')' || char === ']' || char === '}')) {
      depth = Math.max(0, depth - 1);
      current += char;
      continue;
    }
    if (!inString && depth === 0 && char === ',') {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim()) {
    args.push(current.trim());
  }

  return args;
}

function parseFormatter(raw: string | null): CalcFormatterSpec | null {
  if (!raw) return null;
  const match = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)$/);
  if (!match) {
    return {
      name: raw,
      args: [],
    };
  }

  return {
    name: match[1],
    args: splitArguments(match[2]),
  };
}

export function classifyCalcSheetLine(raw: string): ClassifiedCalcSheetLine {
  if (!raw.trim()) {
    return { kind: 'blank', match: null };
  }

  const commentMatch = raw.match(/^(\s*)(\/\/.*)$/);
  if (commentMatch) {
    return { kind: 'comment', match: commentMatch };
  }

  const sectionMatch = raw.match(/^(\s*)(#{1,6})(\s+)(.*)$/);
  if (sectionMatch) {
    return {
      kind: 'section',
      match: sectionMatch,
      sectionTitle: sectionMatch[4].trim(),
    };
  }

  const assertMatch = raw.match(/^(\s*)(assert)(\s+)(.+)$/);
  if (assertMatch) {
    return {
      kind: 'assert',
      match: assertMatch,
      calcAttempt: 'assert',
      assertionExpression: assertMatch[4].trim(),
    };
  }
  const assertAttemptMatch = raw.match(/^(\s*)(assert)\b/);
  if (assertAttemptMatch) {
    return { kind: 'unknown', match: assertAttemptMatch, calcAttempt: 'assert' };
  }

  const bindingMatch = raw.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*)(=)/);
  if (bindingMatch) {
    const right = raw.slice(bindingMatch[0].length).trim();
    const { expression, formatter } = splitFormatter(right);
    if (!expression) {
      return { kind: 'unknown', match: bindingMatch, calcAttempt: 'binding' };
    }
    return {
      kind: 'binding',
      match: bindingMatch,
      calcAttempt: 'binding',
      binding: {
        name: bindingMatch[2],
        expression,
        formatter: parseFormatter(formatter),
      },
    };
  }

  return { kind: 'prose', match: null };
}
