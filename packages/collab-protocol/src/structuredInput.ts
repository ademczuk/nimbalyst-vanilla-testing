/**
 * Shared typed-input vocabulary.
 *
 * These contracts describe field and answer shapes only. They deliberately
 * carry no prompt correlation, persistence, transport, or waiting semantics,
 * so local interactive prompts can reuse them without acquiring a collaboration
 * dependency at runtime.
 */

export const STRUCTURED_INPUT_FIELD_TYPES = [
  "multiSelect",
  "singleSelect",
  "reorder",
  "editText",
  "confirm",
] as const;

export type StructuredInputFieldType =
  (typeof STRUCTURED_INPUT_FIELD_TYPES)[number];

export interface StructuredInputBaseField {
  id: string;
  label: string;
  description?: string;
}

export interface StructuredInputMultiSelectItem {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  defaultChecked?: boolean;
}

export interface StructuredInputMultiSelectField
  extends StructuredInputBaseField {
  type: "multiSelect";
  items: StructuredInputMultiSelectItem[];
  minSelected?: number;
  maxSelected?: number;
}

export interface StructuredInputSingleSelectOption {
  id: string;
  label: string;
  description?: string;
}

export interface StructuredInputSingleSelectField
  extends StructuredInputBaseField {
  type: "singleSelect";
  options: StructuredInputSingleSelectOption[];
  allowOther?: boolean;
}

export interface StructuredInputReorderItem {
  id: string;
  title: string;
  subtitle?: string;
  removable?: boolean;
}

export interface StructuredInputReorderField extends StructuredInputBaseField {
  type: "reorder";
  items: StructuredInputReorderItem[];
  minItems?: number;
}

export interface StructuredInputEditTextField extends StructuredInputBaseField {
  type: "editText";
  initialText: string;
  format?: "markdown" | "plain";
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
}

export interface StructuredInputConfirmField extends StructuredInputBaseField {
  type: "confirm";
  defaultValue?: boolean;
}

export interface StructuredInputFieldByType {
  multiSelect: StructuredInputMultiSelectField;
  singleSelect: StructuredInputSingleSelectField;
  reorder: StructuredInputReorderField;
  editText: StructuredInputEditTextField;
  confirm: StructuredInputConfirmField;
}

export type StructuredInputField =
  StructuredInputFieldByType[StructuredInputFieldType];

export interface StructuredInputAnswerByType {
  multiSelect: { type: "multiSelect"; selectedIds: string[] };
  singleSelect: {
    type: "singleSelect";
    selectedId: string;
    otherText?: string;
  };
  reorder: {
    type: "reorder";
    orderedIds: string[];
    removedIds: string[];
  };
  editText: { type: "editText"; text: string; edited: boolean };
  confirm: { type: "confirm"; value: boolean };
}

export type StructuredInputAnswer =
  StructuredInputAnswerByType[StructuredInputFieldType];
