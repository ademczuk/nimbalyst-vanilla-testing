/**
 * The preview is an upgrade over the subject row, never a replacement for it.
 *
 * That contract is the whole reason this component grew a `renderPreview` prop
 * instead of a second component: a host with no renderer, a renderer that
 * declines a subject, and a resolver reporting a subject it cannot open all
 * have to keep working exactly as they did. None of that is visible by reading
 * the JSX, because the interesting cases are the ones that render *less*.
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { FeedbackArtifact } from '@nimbalyst/collab-protocol';

import { FeedbackArtifactSubjects } from '../FeedbackArtifactSubjects';
import {
  feedbackSubjectDetailEntries,
  feedbackSubjectEntryId,
} from '../feedbackSubjectEntries';

const MOCKUP: FeedbackArtifact = {
  ref: { orgId: 'org-1', kind: 'document', sourceId: 'doc-share-popover' },
  label: 'Share popover, team-first',
  context: 'nimbalyst-local / mockups',
};

describe('FeedbackArtifactSubjects previews', () => {
  it('falls back to the row for every way a preview can be absent', () => {
    const rows = () => screen.queryAllByTestId('feedback-artifact-subject');
    const panels = () => screen.queryAllByTestId('feedback-artifact-subject-expand');

    // No renderer at all.
    const bare = render(<FeedbackArtifactSubjects subjects={[MOCKUP]} />);
    expect(rows()).toHaveLength(1);
    expect(panels()).toHaveLength(0);
    screen.getByText('Share popover, team-first');
    bare.unmount();

    // A renderer that declines this subject -- "I could paint, this one has
    // nothing worth showing" -- which is not the same as having no renderer.
    const declining = render(
      <FeedbackArtifactSubjects subjects={[MOCKUP]} renderPreview={() => null} />,
    );
    expect(rows()).toHaveLength(1);
    expect(panels()).toHaveLength(0);
    declining.unmount();

    // A renderer that paints: panel *and* row, not panel instead of row.
    render(
      <FeedbackArtifactSubjects
        subjects={[MOCKUP]}
        renderPreview={() => <div data-testid="painted" />}
        onExpand={() => {}}
      />,
    );
    expect(panels()).toHaveLength(1);
    screen.getByTestId('painted');
    screen.getByText('Share popover, team-first');
  });

  it('keeps explaining a subject it cannot open, with a preview or without', () => {
    const resolveAction = () => ({ unavailableReason: 'Open the owning project.' });

    const plain = render(
      <FeedbackArtifactSubjects subjects={[MOCKUP]} resolveAction={resolveAction} />,
    );
    screen.getByText('Open the owning project.');
    plain.unmount();

    render(
      <FeedbackArtifactSubjects
        subjects={[MOCKUP]}
        resolveAction={resolveAction}
        renderPreview={() => <div />}
      />,
    );
    // The reason lives on the row, and the row survives the upgrade.
    screen.getByText('Open the owning project.');
  });

  it('hands the clicked subject and its card to the expander', () => {
    const onExpand = vi.fn();
    render(
      <FeedbackArtifactSubjects
        subjects={[MOCKUP]}
        renderPreview={() => <div />}
        onExpand={onExpand}
      />,
    );

    fireEvent.click(screen.getByTestId('feedback-artifact-subject-expand'));

    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onExpand.mock.calls[0][0].label).toBe('Share popover, team-first');
    // The anchor is the card, so a popover can key dismissal and focus return
    // to the thing it grew from.
    expect((onExpand.mock.calls[0][1] as HTMLElement).className)
      .toContain('feedback-artifact-subject-card');
  });
});

describe('feedbackSubjectEntries', () => {
  it('gives two subjects naming one resource distinct, stable entry ids', () => {
    const twice = [MOCKUP, { ...MOCKUP, label: 'Same file, second opinion' }];
    const entries = feedbackSubjectDetailEntries(twice);

    // Distinct: collapsing them would make the popover step to the wrong one.
    expect(entries[0]!.entryId).not.toBe(entries[1]!.entryId);
    // Stable: the id keys the mount that paints the artifact, so an id that
    // changed per render would remount the editor per render.
    expect(feedbackSubjectDetailEntries(twice)[0]!.entryId).toBe(entries[0]!.entryId);
    expect(entries[0]!.artifact.entryId).toBe(feedbackSubjectEntryId(MOCKUP, 0));
    expect(entries[1]!.label).toBe('Same file, second opinion');
  });
});
