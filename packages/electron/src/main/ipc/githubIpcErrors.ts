import { GhApiError, getWorkflowScopeRecoveryMessage } from '../services/GhApiService';

export interface IPCResponse<T> {
  success: boolean;
  error?: string;
  data?: T;
}

export function errorResponse(error: unknown): IPCResponse<never> {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return { success: false, error: message };
}

export function ghErrorResponse(error: unknown): IPCResponse<never> {
  if (!(error instanceof GhApiError)) return errorResponse(error);

  const stderr = error.stderr.trim();
  const workflowScopeRecovery = getWorkflowScopeRecoveryMessage(stderr);
  if (workflowScopeRecovery) {
    return { success: false, error: workflowScopeRecovery };
  }
  if (/Not Found|HTTP 404/i.test(stderr)) {
    return {
      success: false,
      error:
        'Repository not found, or the active GitHub CLI account cannot access it. ' +
        'Check `gh auth status` and switch accounts with `gh auth switch` if needed.',
    };
  }
  return {
    success: false,
    error: `${error.message}: ${stderr || `exit ${error.exitCode}`}`,
  };
}
