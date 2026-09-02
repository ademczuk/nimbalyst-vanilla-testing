/**
 * Typed failures for the history adapters a DocumentModel depends on.
 *
 * `DocumentModelRegistry` currently turns `getPendingTags`/`getDiffBaseline`
 * failures into empty results and `updateTagStatus` failure into success, so
 * absence and transport failure share a return value. That is what lets a
 * failed tag update look like a completed resolution: the baseline reaches disk
 * while the tag stays pending, and reopening the file finds an invisible diff
 * (NIM-5359, defect I).
 *
 * Adapters log at the boundary and then throw one of these, so initialization
 * can stay retryable and resolution can retain recovery state.
 */
export type HistoryAdapterOperation =
  | 'getPendingTags'
  | 'getDiffBaseline'
  | 'updateTagStatus';

export class HistoryAdapterError extends Error {
  readonly operation: HistoryAdapterOperation;
  readonly filePath: string;
  readonly cause: unknown;

  constructor(operation: HistoryAdapterOperation, filePath: string, cause: unknown) {
    super(`History adapter ${operation} failed for ${filePath}`);
    this.name = 'HistoryAdapterError';
    this.operation = operation;
    this.filePath = filePath;
    this.cause = cause;
  }
}

export function isHistoryAdapterError(err: unknown): err is HistoryAdapterError {
  return err instanceof HistoryAdapterError;
}
