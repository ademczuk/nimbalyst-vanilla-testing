/**
 * Table transformer for markdown import/export. Cell content uses the
 * editor's live transformer set, including extension contributions.
 */

import { getEditorTransformers } from '../../markdown';
import { createTableTransformer } from './createTableTransformer';

export const TABLE_TRANSFORMER = createTableTransformer(getEditorTransformers);
