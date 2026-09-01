/** Coerce PGLite booleans and SQLite 0/1 values to one strict boolean shape. */
export function fromDbBoolean(value: unknown): boolean {
  return value === true || value === 1;
}
