import { useEffect, useMemo, useRef, useState } from 'react';
import type { EditorHostProps } from '@nimbalyst/extension-sdk';
import { evaluateCalcSheet } from './evaluator';
import { parseCalcSheetDocument } from './parser';

const EDITOR_LINE_HEIGHT = 30;
const EDITOR_VERTICAL_PADDING = 8;

function lineTitle(
  line: ReturnType<typeof parseCalcSheetDocument>['lines'][number],
  evaluation: ReturnType<typeof evaluateCalcSheet>,
): string | undefined {
  if (line.kind === 'binding' && line.binding) {
    const result = evaluation.bindings.get(line.binding.name);
    if (!result) return undefined;
    const parts = [
      `${result.classification === 'constant' ? 'Constant' : 'Formula'}: ${line.binding.name}`,
    ];
    if (result.dependencies.length > 0) {
      parts.push(`Depends on: ${result.dependencies.join(', ')}`);
    }
    if (result.error) {
      parts.push(`Error: ${result.error}`);
    }
    return parts.join('\n');
  }
  if (line.kind === 'assert' && line.assertion) {
    const assertion = evaluation.assertions.find(
      (entry) => entry.expression === line.assertion?.expression,
    );
    if (!assertion) return undefined;
    const parts = [`Assertion: ${line.assertion.expression}`];
    if (assertion.dependencies.length > 0) {
      parts.push(`Depends on: ${assertion.dependencies.join(', ')}`);
    }
    if (assertion.error) {
      parts.push(`Error: ${assertion.error}`);
    }
    return parts.join('\n');
  }
  if (line.parseError) {
    return line.parseError;
  }
  return undefined;
}

export function CalcSheetShareViewer({ host }: EditorHostProps) {
  const [bodyContent, setBodyContent] = useState<string>('');
  const [initialBodyContent, setInitialBodyContent] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const frontmatterBlockRef = useRef('');

  useEffect(() => {
    let mounted = true;

    host.loadContent()
      .then((content) => {
        if (!mounted) return;
        const parsed = parseCalcSheetDocument(content);
        frontmatterBlockRef.current = parsed.frontmatterBlock;
        setBodyContent(parsed.body);
        setInitialBodyContent(parsed.body);
      })
      .catch((error) => {
        if (!mounted) return;
        setLoadError(error instanceof Error ? error.message : 'Failed to load calc sheet');
      });

    return () => {
      mounted = false;
    };
  }, [host]);

  const documentContent = `${frontmatterBlockRef.current}${bodyContent}`;
  const parsed = useMemo(() => parseCalcSheetDocument(documentContent), [documentContent]);
  const evaluation = useMemo(
    () => evaluateCalcSheet(parsed.lines, parsed.frontmatter, parsed.lines.length),
    [parsed],
  );

  const lineCount = Math.max(1, bodyContent.split(/\r?\n/).length);
  const lineNumbers = Array.from({ length: lineCount }, (_, index) => index + 1);
  const title = parsed.frontmatter.title || host.fileName;
  const baseCurrency = parsed.frontmatter.baseCurrency || 'USD';
  const hasLocalChanges = bodyContent !== initialBodyContent;

  if (loadError) {
    return (
      <div className="calc-sheets calc-sheets--error">
        Failed to load calc sheet: {loadError}
      </div>
    );
  }

  return (
    <div className="calc-sheets">
      <div className="calc-sheets__header">
        <div className="calc-sheets__title-group">
          <div className="calc-sheets__title">{title}</div>
          <div className="calc-sheets__subtitle">
            Shared calc sheet. Local edits recalculate results but do not save back to the source file.
          </div>
        </div>
        <div className="calc-sheets__meta">
          <span>Base currency: {baseCurrency}</span>
          <span>Errors: {evaluation.errorCount}</span>
          {hasLocalChanges ? <span>Local edits active</span> : null}
          <button
            type="button"
            className="calc-sheets__action"
            disabled={!hasLocalChanges}
            onClick={() => {
              setBodyContent(initialBodyContent);
              setScrollTop(0);
            }}
          >
            Reset
          </button>
        </div>
      </div>

      {parsed.frontmatterError ? (
        <div className="calc-sheets__banner calc-sheets__banner--error">
          Frontmatter error: {parsed.frontmatterError}
        </div>
      ) : null}

      <div className="calc-sheets__viewer-surface">
        <div className="calc-sheets__line-numbers" aria-hidden="true">
          <div
            className="calc-sheets__line-number-list"
            style={{ transform: `translateY(${-scrollTop}px)` }}
          >
            {lineNumbers.map((lineNumber) => (
              <div
                key={lineNumber}
                className="calc-sheets__line-number"
                style={{
                  top: EDITOR_VERTICAL_PADDING + ((lineNumber - 1) * EDITOR_LINE_HEIGHT),
                  height: EDITOR_LINE_HEIGHT,
                }}
              >
                {lineNumber}
              </div>
            ))}
          </div>
        </div>

        <div className="calc-sheets__share-editor">
          <textarea
            className="calc-sheets__share-textarea"
            spellCheck={false}
            wrap="off"
            value={bodyContent}
            onChange={(event) => setBodyContent(event.target.value)}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          />
        </div>

        <div className="calc-sheets__gutter" aria-hidden="true">
          <div
            className="calc-sheets__results"
            style={{ height: EDITOR_VERTICAL_PADDING * 2 + (lineCount * EDITOR_LINE_HEIGHT) }}
          >
            {parsed.lines.map((line, index) => {
              const output = evaluation.lineOutputs[index] ?? '';
              const classes = ['calc-sheets__result-line', `calc-sheets__result-line--${line.kind}`];
              if (line.parseError) classes.push('calc-sheets__result-line--error');
              return (
                <div
                  key={`${index}-${line.raw}`}
                  className={classes.join(' ')}
                  style={{
                    top: EDITOR_VERTICAL_PADDING + (index * EDITOR_LINE_HEIGHT) - scrollTop,
                    height: EDITOR_LINE_HEIGHT,
                  }}
                  title={lineTitle(line, evaluation)}
                >
                  <span className="calc-sheets__result-value">{output}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
