/**
 * Custom Select component that supports rendering icons in options.
 * Uses @floating-ui/react + FloatingPortal to escape overflow:hidden/auto containers.
 */

import React, { lazy, Suspense, useState } from 'react';
import { MaterialSymbol } from '../../../ui/icons/MaterialSymbol';

const loadCustomSelectPopover = () => import('./CustomSelectPopover');
const CustomSelectPopover = lazy(() =>
  loadCustomSelectPopover().then((module) => ({
    default: module.CustomSelectPopover,
  }))
);

export interface SelectOption {
  value: string;
  label: string;
  icon?: string;
  color?: string;
}

interface CustomSelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  options,
  onChange,
  placeholder = 'Select...',
  required = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [reference, setReference] = useState<HTMLButtonElement | null>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  const handleToggle = () => setIsOpen((prev) => !prev);

  const handleBlur = (e: React.FocusEvent) => {
    // Close if focus leaves both the trigger and the floating panel
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsOpen(false);
    }
  };

  return (
    <div
      className="custom-select relative inline-block w-full"
      onBlur={handleBlur}
    >
      <button
        ref={setReference}
        type="button"
        className="custom-select-trigger flex items-center justify-between w-full py-1.5 px-2 bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)] rounded text-[13px] text-[var(--nim-text)] cursor-pointer transition-all duration-150 hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)] focus:outline-none focus:border-[var(--nim-primary)] focus:shadow-[0_0_0_2px_rgba(59,130,246,0.1)]"
        onClick={handleToggle}
        onPointerEnter={() => {
          void loadCustomSelectPopover();
        }}
        onFocus={() => {
          void loadCustomSelectPopover();
        }}
        onPointerDown={() => {
          void loadCustomSelectPopover();
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {selectedOption ? (
          <span className="custom-select-value flex items-center gap-1.5 flex-1">
            {selectedOption.icon && (
              <MaterialSymbol icon={selectedOption.icon} size={16} />
            )}
            <span>{selectedOption.label}</span>
          </span>
        ) : value ? (
          // The stored value isn't in the current options (an override removed/
          // renamed it, or a peer set it on a different schema). Render it neutrally
          // so the value stays visible and editable instead of silently vanishing.
          <span
            className="custom-select-value custom-select-value-unknown flex items-center gap-1.5 flex-1 text-[var(--nim-text-secondary)]"
            title={`Unrecognized option: ${value}`}
          >
            <MaterialSymbol icon="help_outline" size={16} />
            <span>{String(value)}</span>
          </span>
        ) : (
          <span className="custom-select-placeholder text-[var(--nim-text-faint)]">
            {placeholder}
          </span>
        )}
        <MaterialSymbol
          icon={isOpen ? 'expand_less' : 'expand_more'}
          size={16}
        />
      </button>

      {isOpen && reference && (
        <Suspense fallback={null}>
          <CustomSelectPopover
            reference={reference}
            value={value}
            options={options}
            required={required}
            onSelect={handleSelect}
          />
        </Suspense>
      )}
    </div>
  );
};
