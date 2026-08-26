import { useLayoutEffect, type JSX } from 'react';
import {
  flip,
  FloatingPortal,
  offset,
  shift,
  size,
  useFloating,
  useFloatingNodeId,
  type ReferenceElement,
} from '@floating-ui/react';
import { windowControlsClearance } from '../../../ui/floating/windowControlsClearance';
import { MaterialSymbol } from '../../../ui/icons/MaterialSymbol';
import type { SelectOption } from './CustomSelect';

export interface CustomSelectPopoverProps {
  reference: ReferenceElement;
  value: string;
  options: SelectOption[];
  required: boolean;
  onSelect: (value: string) => void;
}

/** Floating option list loaded only after the select trigger opens. */
export function CustomSelectPopover({
  reference,
  value,
  options,
  required,
  onSelect,
}: CustomSelectPopoverProps): JSX.Element {
  const nodeId = useFloatingNodeId();
  const { refs, floatingStyles } = useFloating({
    nodeId,
    open: true,
    placement: 'bottom-start',
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      windowControlsClearance(),
      size({
        apply({ rects, elements }) {
          Object.assign(elements.floating.style, {
            minWidth: `${rects.reference.width}px`,
          });
        },
      }),
    ],
  });

  useLayoutEffect(() => {
    refs.setPositionReference(reference);
  }, [reference, refs]);

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        className="custom-select-dropdown bg-[var(--nim-bg)] border border-[var(--nim-border)] rounded shadow-[0_4px_12px_rgba(0,0,0,0.15)] max-h-[300px] overflow-y-auto z-[9999]"
        style={floatingStyles}
        onMouseDown={(event) => event.preventDefault()}
      >
        {!required && (
          <button
            type="button"
            className="custom-select-option flex items-center gap-1.5 w-full py-2 px-2.5 border-none cursor-pointer text-[13px] text-[var(--nim-text)] text-left transition-colors duration-100 hover:bg-[var(--nim-bg-hover)]"
            onClick={() => onSelect('')}
          >
            <span className="custom-select-option-label flex-1">None</span>
          </button>
        )}
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`custom-select-option flex items-center gap-1.5 w-full py-2 px-2.5 border-none cursor-pointer text-[13px] text-[var(--nim-text)] text-left transition-colors duration-100 hover:bg-[var(--nim-bg-hover)] ${
              option.value === value
                ? 'selected bg-[var(--nim-bg-tertiary)] font-medium'
                : ''
            }`}
            onClick={() => onSelect(option.value)}
          >
            {option.icon && <MaterialSymbol icon={option.icon} size={16} />}
            <span className="custom-select-option-label flex-1">
              {option.label}
            </span>
          </button>
        ))}
      </div>
    </FloatingPortal>
  );
}
