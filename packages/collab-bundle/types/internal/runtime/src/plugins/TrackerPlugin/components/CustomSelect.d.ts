/**
 * Custom Select component that supports rendering icons in options.
 * Uses @floating-ui/react + FloatingPortal to escape overflow:hidden/auto containers.
 */
import React from 'react';
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
export declare const CustomSelect: React.FC<CustomSelectProps>;
export {};
