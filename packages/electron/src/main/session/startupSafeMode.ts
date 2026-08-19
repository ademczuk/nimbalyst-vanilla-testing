export function isSafeModeArgument(value: string): boolean {
  return value === '--safe-mode' || value === '--no-restore';
}
