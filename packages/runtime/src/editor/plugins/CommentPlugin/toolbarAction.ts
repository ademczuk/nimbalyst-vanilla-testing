import type { LexicalEditor } from 'lexical';

import { canAuthorComments } from '../../commenting/capabilities';
import type { CommentsConfig } from '../../commenting/types';
import type { FloatingTextToolbarAction } from '../FloatingTextFormatToolbarPlugin/types';
import { OPEN_COMMENT_COMPOSER_COMMAND } from './commands';

export function getCommentToolbarActions(
  comments: CommentsConfig | undefined,
  editor: Pick<LexicalEditor, 'dispatchCommand'>,
): FloatingTextToolbarAction[] {
  if (!comments) return [];
  // Hidden rather than disabled: a read-only viewer's comment is rejected
  // server-side and vanishes on reload, and there is no action they can take to
  // change that from here.
  if (!canAuthorComments(comments)) return [];

  return [
    {
      id: 'comment',
      label: 'Add comment',
      icon: 'add_comment',
      onSelect: () => {
        editor.dispatchCommand(OPEN_COMMENT_COMPOSER_COMMAND, undefined);
      },
    },
  ];
}
