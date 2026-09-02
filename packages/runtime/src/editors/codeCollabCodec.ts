/**
 * The collaborative codec for the built-in `code` document type.
 *
 * Moved out of the electron renderer because the web console needs the exact
 * same object. Three of its fields are load-bearing across hosts and must not
 * be restated anywhere:
 *
 *   - `documentType: 'code'` is what a shared document's index row records, and
 *     what each host's document-type catalog matches on.
 *   - `textField: 'content'` is the Y.Text a Monaco model binds to. A host that
 *     bound a different field would sync cleanly against itself and show an
 *     empty document to everyone else.
 *   - `fileExtensions` decides which suffixes resolve to this type at all.
 *
 * A second copy would compile, pass its own tests, and diverge silently. That
 * is the failure this file exists to make impossible.
 */

// The `/collab` entry, not the SDK barrel. The barrel re-exports the tracker
// reference UI, which imports `@nimbalyst/runtime` -- and in the web console
// that specifier is aliased to a small browser bridge that deliberately does
// not provide those components. Importing the barrel here therefore fails the
// console's production build with a missing export, from a module that only
// wanted one pure factory function.
import { createTextCollabContentAdapter } from '@nimbalyst/extension-sdk/collab';

import { CODE_COLLAB_FILE_EXTENSIONS } from './monacoLanguages';

export { CODE_COLLAB_FILE_EXTENSIONS };

/** The Y.Text field Monaco binds to. Shared by every host. */
export const CODE_COLLAB_TEXT_FIELD = 'content';

// Passed by reference, not spread: `createTextCollabContentAdapter` assigns the
// array straight through, and a test asserts the codec's `fileExtensions` IS
// this constant. A copy here would still hold equal values and would silently
// break that identity.
export const CodeCollabContentAdapter = createTextCollabContentAdapter({
  documentType: 'code',
  fileExtensions: CODE_COLLAB_FILE_EXTENSIONS,
  textField: CODE_COLLAB_TEXT_FIELD,
});
