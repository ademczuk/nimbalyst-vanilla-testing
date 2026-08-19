/**
 * Org-member directory available to the feedback compose surface.
 *
 * The compose widget reads candidates from here; it never talks to IPC or the
 * sync layer itself. A central listener populates this atom once the org
 * directory read lands (plan slices S3/S5). Until then it is empty, and the
 * recipient picker says so rather than pretending to offer people.
 */

import { atom } from 'jotai';
import type { FeedbackRequestRecipient } from '@nimbalyst/collab-protocol';

export const feedbackRecipientDirectoryAtom = atom<FeedbackRequestRecipient[]>([]);
