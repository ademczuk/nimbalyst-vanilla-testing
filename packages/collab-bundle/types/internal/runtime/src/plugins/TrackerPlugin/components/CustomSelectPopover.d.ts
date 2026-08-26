import { type JSX } from 'react';
import { type ReferenceElement } from '@floating-ui/react';
import type { SelectOption } from './CustomSelect';
export interface CustomSelectPopoverProps {
    reference: ReferenceElement;
    value: string;
    options: SelectOption[];
    required: boolean;
    onSelect: (value: string) => void;
}
/** Floating option list loaded only after the select trigger opens. */
export declare function CustomSelectPopover({ reference, value, options, required, onSelect, }: CustomSelectPopoverProps): JSX.Element;
