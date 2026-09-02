/**
 * The `code` codec now lives in `@nimbalyst/runtime` so the web console binds
 * the same `documentType` / `textField` / suffix list this renderer does. These
 * re-exports keep the renderer's existing import sites working.
 */
import {
  CODE_COLLAB_FILE_EXTENSIONS,
  CodeCollabContentAdapter,
} from '@nimbalyst/runtime/editors/codeCollabCodec';

export { CODE_COLLAB_FILE_EXTENSIONS, CodeCollabContentAdapter };

export function getCodeCollabExportFileName(
  sourceName: string,
  fileExtension?: string,
): string {
  const leafName = sourceName.slice(
    Math.max(sourceName.lastIndexOf('/'), sourceName.lastIndexOf('\\')) + 1,
  ) || 'document';
  const currentSuffix = [...CodeCollabContentAdapter.fileExtensions]
    .sort((left, right) => right.length - left.length)
    .find(suffix => leafName.toLowerCase().endsWith(suffix.toLowerCase()));
  const preferredSuffix = fileExtension
    ?? currentSuffix
    ?? CodeCollabContentAdapter.fileExtensions[0]
    ?? '.txt';

  if (leafName.toLowerCase().endsWith(preferredSuffix.toLowerCase())) {
    return leafName;
  }
  return `${currentSuffix ? leafName.slice(0, -currentSuffix.length) : leafName}${preferredSuffix}`;
}
