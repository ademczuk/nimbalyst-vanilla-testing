import React, { useEffect, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type {
  TrackerSchemaChangeGateVerdict,
  TrackerSchemaDestructiveConfirmCopy,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/models/trackerSchemaChangeClassifier';

/** Shape of the `tracker-schema:preview-change` result. */
export interface TrackerSchemaChangePreview {
  classification: 'none' | 'additive' | 'destructive';
  verdict: TrackerSchemaChangeGateVerdict;
  blastRadiusText: string;
  copy?: TrackerSchemaDestructiveConfirmCopy;
}

/**
 * The confirm for a destructive tracker schema change. It exists to answer two
 * questions before anything is applied: how much of your data this reaches, and
 * whether the removal is really a rename.
 *
 * There is no "delete the values" choice, and that is deliberate: retiring a
 * field leaves its values in the store untouched, so nothing here can destroy
 * data. Deleting item data is a separate, deliberate act and is not offered from
 * a schema edit.
 */
export function TrackerSchemaChangeConfirm({
  preview,
  pending,
  onApply,
  onCancel,
}: {
  preview: TrackerSchemaChangePreview | null;
  pending?: boolean;
  onApply: (optionId: string) => void;
  onCancel: () => void;
}) {
  const copy = preview?.copy;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedId(copy?.options[0]?.id ?? null);
  }, [copy]);

  if (!preview || !copy) return null;

  const blockedOnAdmin =
    !preview.verdict.allowed && preview.verdict.reason === 'requires-admin';

  return (
    <div className="nim-overlay tracker-schema-change-confirm-overlay" onClick={onCancel}>
      <div
        className="tracker-schema-change-confirm nim-modal min-w-[440px] max-w-[560px] p-6"
        data-testid="tracker-schema-change-confirm"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="m-0 mb-3 text-lg font-semibold text-nim">{copy.title}</h2>

        <div
          className="tracker-schema-blast-radius flex items-start gap-2 mb-3 px-3 py-2 rounded bg-[var(--nim-bg-tertiary)]"
          data-testid="tracker-schema-blast-radius"
        >
          <MaterialSymbol icon="database" size={16} className="mt-[2px] text-[var(--nim-text-muted)]" />
          <span className="text-[13px] text-nim leading-relaxed">{preview.blastRadiusText}</span>
        </div>

        <p className="m-0 mb-4 text-sm text-nim-muted leading-relaxed">{copy.message}</p>

        {blockedOnAdmin ? (
          <p
            className="tracker-schema-admin-required m-0 mb-5 text-sm text-nim leading-relaxed"
            data-testid="tracker-schema-admin-required"
          >
            Only a team admin can remove or rename part of a tracker your team shares.
            Adding fields, statuses and options stays open to everyone.
          </p>
        ) : (
          <div className="tracker-schema-change-options flex flex-col gap-2 mb-5">
            {copy.options.map((option) => (
              <label
                key={option.id}
                className={`flex items-start gap-2.5 px-3 py-2.5 rounded border cursor-pointer ${
                  selectedId === option.id
                    ? 'border-[var(--nim-primary)] bg-[var(--nim-bg-tertiary)]'
                    : 'border-[var(--nim-border)]'
                }`}
              >
                <input
                  type="radio"
                  name="tracker-schema-change-option"
                  className="mt-[3px]"
                  checked={selectedId === option.id}
                  onChange={() => setSelectedId(option.id)}
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-medium text-nim">{option.label}</span>
                  <span className="block text-[12px] text-nim-muted leading-relaxed">
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button className="nim-btn-secondary" onClick={onCancel}>
            {blockedOnAdmin ? 'Close' : 'Cancel'}
          </button>
          {!blockedOnAdmin && (
            <button
              className="nim-btn-primary"
              data-testid="tracker-schema-change-apply"
              disabled={pending || !selectedId}
              onClick={() => selectedId && onApply(selectedId)}
            >
              {pending ? 'Working…' : copy.confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
