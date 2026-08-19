/**
 * The one floating menu the compose surface uses, for the recipient picker and
 * every delivery setting.
 *
 * Positioning is @floating-ui/react through a FloatingPortal, per
 * .claude/rules/floating-ui.md -- no hand-computed `position: fixed`, so it
 * survives viewport edges, transformed ancestors, and the transcript's own
 * scroll container.
 */

import React, { useState } from 'react';
import {
  FloatingFocusManager,
  FloatingPortal,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { windowControlsClearance } from '../../../../floating/windowControlsClearance';

export interface FeedbackComposeMenuProps {
  /** Trigger contents; the caret is added by this component. */
  trigger: React.ReactNode;
  triggerTestId?: string;
  ariaLabel: string;
  disabled?: boolean;
  /** Menu contents. Call `close` after acting on a choice. */
  children: (close: () => void) => React.ReactNode;
}

export const FeedbackComposeMenu: React.FC<FeedbackComposeMenuProps> = ({
  trigger,
  triggerTestId,
  ariaLabel,
  disabled,
  children,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'bottom-start',
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 }), windowControlsClearance()],
  });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    useDismiss(context),
    useRole(context, { role: 'menu' }),
  ]);

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        data-testid={triggerTestId}
        aria-label={ariaLabel}
        disabled={disabled}
        {...getReferenceProps({ onClick: () => setIsOpen((open) => !open) })}
        className="feedback-compose-menu-trigger flex items-center gap-1.5 text-xs text-nim bg-nim-secondary border border-nim rounded px-2 py-1 cursor-pointer hover:bg-nim-hover disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {trigger}
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="text-nim-faint shrink-0">
          <path d="M1.5 3L4 5.5L6.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {isOpen && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              {...getFloatingProps()}
              className="feedback-compose-menu z-50 min-w-[13rem] max-h-72 overflow-y-auto rounded-md border border-nim bg-nim-secondary shadow-lg py-1"
            >
              {children(() => setIsOpen(false))}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
};

export const FeedbackComposeMenuItem: React.FC<{
  onSelect: () => void;
  selected?: boolean;
  testId?: string;
  children: React.ReactNode;
}> = ({ onSelect, selected, testId, children }) => (
  <button
    type="button"
    role="menuitem"
    data-testid={testId}
    onClick={onSelect}
    className={`feedback-compose-menu-item w-full text-left px-3 py-1.5 text-xs cursor-pointer bg-transparent border-none hover:bg-nim-hover ${
      selected ? 'text-nim-primary' : 'text-nim'
    }`}
  >
    {children}
  </button>
);
