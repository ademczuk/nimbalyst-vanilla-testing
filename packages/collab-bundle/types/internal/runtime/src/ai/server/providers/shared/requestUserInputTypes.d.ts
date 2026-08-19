/**
 * PromptForUserInput compatibility names.
 *
 * The field and answer vocabulary is owned by collab-protocol so feedback asks
 * and this local blocking prompt cannot drift. This module intentionally adds
 * only prompt presentation/result envelopes; transport, persistence, and
 * correlation remain entirely in the existing local prompt system.
 */
import type { StructuredInputAnswer, StructuredInputBaseField, StructuredInputConfirmField, StructuredInputEditTextField, StructuredInputField, StructuredInputMultiSelectField, StructuredInputMultiSelectItem, StructuredInputReorderField, StructuredInputReorderItem, StructuredInputSingleSelectField, StructuredInputSingleSelectOption } from '@nimbalyst/collab-protocol';
export type RequestUserInputBaseField = StructuredInputBaseField;
export type RequestUserInputMultiSelectItem = StructuredInputMultiSelectItem;
export type RequestUserInputMultiSelectField = StructuredInputMultiSelectField;
export type RequestUserInputSingleSelectOption = StructuredInputSingleSelectOption;
export type RequestUserInputSingleSelectField = StructuredInputSingleSelectField;
export type RequestUserInputReorderItem = StructuredInputReorderItem;
export type RequestUserInputReorderField = StructuredInputReorderField;
export type RequestUserInputEditTextField = StructuredInputEditTextField;
export type RequestUserInputConfirmField = StructuredInputConfirmField;
export type RequestUserInputField = StructuredInputField;
export type RequestUserInputAnswer = StructuredInputAnswer;
export interface RequestUserInputArgs {
    title?: string;
    intro?: string;
    fields: RequestUserInputField[];
    submitLabel?: string;
    cancelLabel?: string;
}
export interface RequestUserInputResult {
    cancelled?: boolean;
    answers: Record<string, RequestUserInputAnswer>;
}
