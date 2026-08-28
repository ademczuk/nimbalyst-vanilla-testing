/**
 * Opening the destination picker and waiting for the author.
 *
 * Same shape as `askShareToTeam`, and for the same reason: `DialogProvider`
 * calls `onDismiss` on every removal, including the close that follows a
 * confirmation, so a caller that cannot tell the two apart would read a
 * dismissal as a choice and quietly move the author's subjects.
 *
 * Resolving null means "no answer" and must leave the draft's destination
 * exactly as it was.
 */

import { dialogRef, DIALOG_IDS } from '../../dialogs';
import type { FeedbackDestinationData } from '../../dialogs/teamDialogs';
import type { FeedbackComposeDestination } from '@nimbalyst/runtime/ui/AgentTranscript/components/CustomToolWidgets/InteractiveWidgetHost';

export async function askFeedbackDestination(params: {
  folderId: string | null;
  subjectCount: number;
}): Promise<FeedbackComposeDestination | null> {
  const dialogs = dialogRef.current;
  if (!dialogs) return null;

  return new Promise<FeedbackComposeDestination | null>((resolve) => {
    let answered = false;
    dialogs.open<FeedbackDestinationData>(DIALOG_IDS.FEEDBACK_DESTINATION, {
      initialFolderId: params.folderId,
      subjectCount: params.subjectCount,
      onConfirm: (destination) => {
        answered = true;
        resolve(destination);
      },
      onDismiss: () => {
        if (!answered) resolve(null);
      },
    });
  });
}
