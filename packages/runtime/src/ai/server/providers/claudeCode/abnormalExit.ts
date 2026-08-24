/**
 * Classification of abnormal `claude` subprocess exits (GitHub #1361).
 *
 * When the bundled CLI dies from a native fault it produces no stream-json
 * output and usually no stderr at all -- the SDK's only signal is the raw
 * wait status, which reaches the transcript verbatim as
 * `Claude Code process exited with code 3221225477`. In #1361 that happened on
 * ~80% of spawns on Windows 11 x64 and the reporter had nothing to go on but
 * the integer.
 *
 * `isBunRuntimeSpawnCrash` (see spawnCrashDiagnostics.ts) does not cover this:
 * it requires Bun's `"An unknown error occurred"` stderr line, which a native
 * fault never gets far enough to print.
 *
 * The decision is a pure function on purpose. A native crash can only be
 * produced by an environment we cannot reproduce on a maintainer machine, so
 * the classification and the retry policy are tested here on the facts rather
 * than in the provider where they would never execute under observation.
 */

/** Fault class behind an abnormal exit status. */
export type AbnormalExitKind =
  | 'access-violation'
  | 'stack-overflow'
  | 'segfault'
  | 'aborted'
  | 'killed';

export interface AbnormalExitAssessment {
  kind: AbnormalExitKind;
  exitCode: number;
  /**
   * Readable replacement for the raw `exited with code NNN` text. Names the
   * fault and the binary, so a bug report carries a cause instead of a number.
   */
  message: string;
  /** True when a fresh spawn is worth exactly one attempt. */
  retryable: boolean;
}

interface ExitSignature {
  code: number;
  kind: AbnormalExitKind;
  description: string;
  /**
   * False for faults a second spawn will hit identically. An OOM kill is the
   * clear case: the memory ceiling does not move between attempts, so a retry
   * only doubles the wait before the same failure.
   */
  transient: boolean;
}

/**
 * Windows reports the NTSTATUS value directly; POSIX shells report 128+signal.
 * Both spellings of the same fault appear in the wild for one binary, because
 * the SDK surfaces whatever the platform put in the wait status.
 */
const EXIT_SIGNATURES: readonly ExitSignature[] = [
  // 0xC0000005 STATUS_ACCESS_VIOLATION
  { code: 3221225477, kind: 'access-violation', description: 'crashed with a memory access violation', transient: true },
  // 0xC00000FD STATUS_STACK_OVERFLOW
  { code: 3221225725, kind: 'stack-overflow', description: 'crashed with a stack overflow', transient: true },
  // 128 + SIGSEGV(11)
  { code: 139, kind: 'segfault', description: 'crashed with a segmentation fault', transient: true },
  // 128 + SIGABRT(6)
  { code: 134, kind: 'aborted', description: 'aborted itself', transient: true },
  // 128 + SIGKILL(9) -- overwhelmingly the OOM killer in this codepath.
  { code: 137, kind: 'killed', description: 'was killed by the operating system, most likely for running out of memory', transient: false },
];

/** Pulls the wait status out of the SDK's `exited with code N` phrasing. */
function parseExitCode(errorMessage: string): number | null {
  const match = /exited with code (\d+)/.exec(errorMessage);
  if (!match) return null;
  const code = Number(match[1]);
  return Number.isSafeInteger(code) ? code : null;
}

/**
 * Classify a failed turn as a native subprocess crash, or return null to leave
 * the existing error message alone.
 *
 * Returning null is the common case and the safe one: an ordinary non-zero
 * exit (auth failure, bad config) already carries a better message than
 * anything this function could synthesise.
 *
 * `producedOutput` gates the retry, not the classification. Once any of the
 * turn has been streamed to the transcript, replaying the prompt would emit it
 * a second time, so a crash that late is reported but never retried.
 */
export function classifyAbnormalChildExit(args: {
  errorMessage: string | undefined;
  stderrLines: readonly string[];
  producedOutput: boolean;
}): AbnormalExitAssessment | null {
  const errorMessage = args.errorMessage ?? '';
  const exitCode = parseExitCode(errorMessage);
  if (exitCode === null) return null;

  const signature = EXIT_SIGNATURES.find(candidate => candidate.code === exitCode);
  if (!signature) return null;

  const retryable = signature.transient && !args.producedOutput;

  const parts = [
    `The Claude Code process ${signature.description} (exit code ${exitCode}).`,
    retryable
      ? 'Retrying once.'
      : 'This turn was not completed. Send the message again to retry.',
  ];

  return {
    kind: signature.kind,
    exitCode,
    message: parts.join(' '),
    retryable,
  };
}
