// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SelectionChips } from '../SelectionChips';
import { clearTextSelection, setTextSelection } from '../TextSelectionIndicator';
import {
  clearEditorContext,
  getActiveEditorContextItems,
  setEditorContextItems,
} from '../../../stores/editorContextStore';

const FILE = '/test/diagram.excalidraw';
const OTHER_FILE = '/test/other.excalidraw';

afterEach(() => {
  cleanup();
  clearTextSelection();
  clearEditorContext(FILE);
  clearEditorContext(OTHER_FILE);
  delete (window as any).__mockupFilePath;
  delete (window as any).__mockupSelectedElement;
  delete (window as any).__mockupDrawing;
  delete (window as any).__mockupAnnotationTimestamp;
});

describe('SelectionChips', () => {
  it('reacts to text-selection events and removes the selection immediately', () => {
    render(<SelectionChips currentFilePath={FILE} />);
    expect(screen.queryByText('Selection')).toBeNull();

    act(() => setTextSelection('selected text', FILE));
    expect(screen.getByText('Selection')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Remove Selection from context'));
    expect(screen.queryByText('Selection')).toBeNull();
  });

  it('dismisses and restores an extension item without sending it while hidden', () => {
    act(() => {
      setEditorContextItems(FILE, [{ id: 'a', label: 'Rectangle A', description: 'A rectangle' }]);
    });
    render(<SelectionChips currentFilePath={FILE} />);

    fireEvent.click(screen.getByLabelText('Remove Rectangle A from context'));
    expect(screen.queryByText('Rectangle A')).toBeNull();
    expect(screen.getByText('1 hidden — restore')).toBeTruthy();
    expect(getActiveEditorContextItems(FILE)).toBeUndefined();

    fireEvent.click(screen.getByText('1 hidden — restore'));
    expect(screen.getByText('Rectangle A')).toBeTruthy();
    expect(getActiveEditorContextItems(FILE)?.[0].id).toBe('a');
  });

  it('scopes extension items to the active file', () => {
    act(() => {
      setEditorContextItems(FILE, [{ id: 'a', label: 'Current file', description: 'current' }]);
      setEditorContextItems(OTHER_FILE, [{ id: 'b', label: 'Other file', description: 'other' }]);
    });

    render(<SelectionChips currentFilePath={FILE} />);
    expect(screen.getByText('Current file')).toBeTruthy();
    expect(screen.queryByText('Other file')).toBeNull();
  });

  it('collapses large groups and can expand them', () => {
    act(() => {
      setEditorContextItems(
        FILE,
        Array.from({ length: 8 }, (_, index) => ({
          id: String(index),
          label: `Shape ${index + 1}`,
          description: `Shape ${index + 1}`,
          groupLabel: 'shapes',
        }))
      );
    });

    render(<SelectionChips currentFilePath={FILE} />);
    expect(screen.getByText('Shape 5')).toBeTruthy();
    expect(screen.queryByText('Shape 6')).toBeNull();

    fireEvent.click(screen.getByLabelText('Show 3 more shapes'));
    expect(screen.getByText('Shape 8')).toBeTruthy();
    expect(screen.getByLabelText('Show fewer shapes')).toBeTruthy();
  });
});
