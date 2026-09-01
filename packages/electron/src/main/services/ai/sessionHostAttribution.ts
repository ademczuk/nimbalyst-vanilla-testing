import { AISessionsRepository } from '@nimbalyst/runtime/storage/repositories/AISessionsRepository';
import { logger } from '../../utils/logger';
import { getSyncProvider } from '../SyncManager';

export type DeviceTargetedRequest = { targetDeviceId?: string };

export function getLocalHostDeviceId(): string | undefined {
  return getSyncProvider()?.getLocalDeviceInfo?.()?.deviceId;
}

export function isTargetedAtAnotherDevice(request: DeviceTargetedRequest, localDeviceId: string | undefined): boolean {
  return request.targetDeviceId !== undefined && request.targetDeviceId !== localDeviceId;
}

/**
 * Record which desktop owns a session, after the session already exists.
 *
 * This is bookkeeping that runs past the point of no return -- for a worktree
 * request the worktree and the session are both on disk by now. A transient
 * repository failure here must not surface as "creation failed", or the phone
 * retries with a new request ID and creates an orphaned duplicate. The truth is
 * narrower and is what gets logged: the session exists, its host attribution
 * did not stick, and the next sync of that row will carry it.
 */
export async function stampSessionHost(sessionId: string, hostDeviceId: string | undefined): Promise<void> {
  if (!hostDeviceId) return;
  try {
    await AISessionsRepository.updateMetadata(sessionId, {
      metadata: { hostDeviceId },
    });
  } catch (error) {
    logger.main.warn(
      `[AIService] Session ${sessionId} was created but host attribution to ${hostDeviceId} failed:`,
      error,
    );
  }
}
