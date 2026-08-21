export interface InitFailureInput {
  errorMessage: string;
  errorName: string;
  /** 1-based attempt that just failed. */
  attempt: number;
  maxAttempts: number;
  /** Earliest attempt permitted to rename the database aside. */
  renameAllowedFromAttempt: number;
  dataDirExists: boolean;
  /**
   * True when the data directory was already on disk before this process
   * started. Such a directory holds the user's data and is never auto-renamed.
   */
  dataDirPredatesLaunch: boolean;
}

export interface InitFailurePlan {
  action: 'rethrow' | 'retry' | 'rename';
  reason:
    | 'not-an-abort'
    | 'attempts-exhausted'
    | 'first-abort-may-be-transient'
    | 'no-data-dir-to-move'
    | 'preexisting-data-needs-consent'
    | 'repeated-aborts-on-directory-we-created';
}

export function planInitFailureResponse(input: InitFailureInput): InitFailurePlan;
