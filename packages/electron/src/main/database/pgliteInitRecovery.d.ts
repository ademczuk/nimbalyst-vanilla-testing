export interface InitFailureInput {
  errorMessage: string;
  errorName: string;
  /** 1-based attempt that just failed. */
  attempt: number;
  maxAttempts: number;
  /** Earliest attempt permitted to rename the database aside. */
  renameAllowedFromAttempt: number;
  dataDirExists: boolean;
}

export interface InitFailurePlan {
  action: 'rethrow' | 'retry' | 'rename';
  reason:
    | 'not-an-abort'
    | 'attempts-exhausted'
    | 'first-abort-may-be-transient'
    | 'no-data-dir-to-move'
    | 'repeated-aborts-on-same-directory';
}

export function planInitFailureResponse(input: InitFailureInput): InitFailurePlan;
