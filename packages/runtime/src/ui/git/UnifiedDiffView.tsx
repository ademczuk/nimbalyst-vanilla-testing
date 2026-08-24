import { useMemo } from 'react';
import { parseUnifiedDiffToHunks, toDisplayLines } from './unifiedDiffModel';

interface UnifiedDiffViewProps {
  diff: string;
  isBinary?: boolean;
  loading?: boolean;
  error?: string | null;
}

const PLACEHOLDER_BASE = 'p-4 text-center text-xs italic text-[var(--nim-text-faint)]';

export function UnifiedDiffView({ diff, isBinary, loading, error }: UnifiedDiffViewProps) {
  const lines = useMemo(() => (diff ? toDisplayLines(parseUnifiedDiffToHunks(diff)) : []), [diff]);

  if (loading) {
    return <div className={PLACEHOLDER_BASE}>Loading diff...</div>;
  }
  if (error) {
    return <div className="p-4 text-center text-xs not-italic text-[var(--nim-error)]">{error}</div>;
  }
  if (isBinary) {
    return <div className={PLACEHOLDER_BASE}>Binary file</div>;
  }
  if (!diff || lines.length === 0) {
    return <div className={PLACEHOLDER_BASE}>No textual changes</div>;
  }

  return (
    <div className="font-mono text-xs leading-normal text-[var(--nim-text-muted)] pb-1.5">
      {lines.map((line, i) => {
        if (line.kind === 'meta') {
          return null;
        }
        if (line.kind === 'hunk') {
          return (
            <div
              key={i}
              className="flex whitespace-pre min-h-[18px] mt-1 bg-[color-mix(in_srgb,var(--nim-purple)_12%,transparent)]"
            >
              <span className="flex flex-none select-none pr-1 text-[var(--nim-text-faint)] text-[11px]" />
              <span className="flex-1 py-0 px-2 text-[var(--nim-purple)] font-medium">{line.text}</span>
            </div>
          );
        }
        const lineBg =
          line.kind === 'add'
            ? 'bg-[color-mix(in_srgb,var(--nim-success)_14%,transparent)]'
            : line.kind === 'del'
              ? 'bg-[color-mix(in_srgb,var(--nim-error)_14%,transparent)]'
              : '';
        const textColor =
          line.kind === 'add'
            ? 'text-[var(--nim-success)]'
            : line.kind === 'del'
              ? 'text-[var(--nim-error)]'
              : 'text-[var(--nim-text-muted)]';
        const signColor =
          line.kind === 'add'
            ? 'text-[var(--nim-success)] opacity-100'
            : line.kind === 'del'
              ? 'text-[var(--nim-error)] opacity-100'
              : 'opacity-65';
        const sign = line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' ';
        return (
          <div key={i} className={`flex whitespace-pre min-h-[18px] ${lineBg}`}>
            <span className="flex flex-none select-none bg-[var(--nim-bg-secondary)] border-r border-[var(--nim-border)] pr-1 text-[var(--nim-text-faint)] text-[11px]">
              <span className="inline-block w-[38px] text-right py-0 px-1 opacity-70">{line.oldLine ?? ''}</span>
              <span className="inline-block w-[38px] text-right py-0 px-1 opacity-70">{line.newLine ?? ''}</span>
              <span className={`inline-block w-[14px] text-center font-semibold ${signColor}`}>{sign}</span>
            </span>
            <span className={`flex-1 py-0 px-2 ${textColor}`}>{line.text || ' '}</span>
          </div>
        );
      })}
    </div>
  );
}

export function diffStats(diff: string): { added: number; removed: number } {
  if (!diff) return { added: 0, removed: 0 };
  let added = 0;
  let removed = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+') && !raw.startsWith('+++')) added++;
    else if (raw.startsWith('-') && !raw.startsWith('---')) removed++;
  }
  return { added, removed };
}
