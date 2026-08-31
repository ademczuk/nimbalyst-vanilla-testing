import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import type { ChatAttachment } from '@nimbalyst/runtime/ai/server/types';
import { ModelIdentifier } from '@nimbalyst/runtime/ai/server/types';
import { AIInput, type AIInputRef } from './AIInput';
import { LaunchPopupShell, useLaunchPopupToggle } from '../LaunchPopup/LaunchPopupShell';
import { expandSessionMentions } from './sessionMentions';
import { errorNotificationService } from '../../services/ErrorNotificationService';
import { createNewSessionActionAtom } from '../../store/actions/sessionHistoryActions';
import { sessionLaunchPopupRequestAtom } from '../../store/atoms/appCommands';
import {
  defaultAgentModelAtom,
  defaultEffortLevelAtom,
  defaultThinkingModeAtom,
  developerModeAtom,
  setAgentModeSettingsAtom,
} from '../../store/atoms/appSettings';
import {
  createEmptySessionLaunchDraft,
  sessionLaunchDraftAtom,
} from '../../store/atoms/sessionLaunchPopup';
import { sessionRegistryAtom } from '../../store/atoms/sessions';
import {
  resolveThinkingMode,
  supportsEffortLevel,
  supportsThinkingToggle,
  type EffortLevel,
  type ThinkingMode,
} from '../../utils/modelUtils';
import { isClaudeCliTerminalSession } from './claudeCliInputRouting';
import { trackSendWallEvent } from '../../utils/sendWallAnalytics';
import {
  bucketPromptLength,
  toStableAnalyticsCategory,
  type SendBlockedReason,
} from '../../../shared/analytics/sendOutcomes';

interface SessionLaunchPopupProps {
  workspacePath: string | null;
}

interface LaunchPromptOptions {
  sessionId: string;
  workspacePath: string;
  provider: string;
  model: string;
  prompt: string;
  mode: 'agent' | 'planning';
  attachments: ChatAttachment[];
}

/** Route the first turn through the same provider-specific seam as SessionTranscript. */
export async function launchSessionPrompt({
  sessionId,
  workspacePath,
  provider,
  model,
  prompt,
  mode,
  attachments,
}: LaunchPromptOptions): Promise<void> {
  if (isClaudeCliTerminalSession(provider)) {
    const ensured = await window.electronAPI.terminal.ensureClaudeCliSession({
      sessionId,
      workspacePath,
      model,
    });
    if (!ensured.success) {
      throw new Error(
        ensured.claudeNotInstalled
          ? 'Claude Code CLI is not installed.'
          : ensured.error || 'Failed to start the Claude Code CLI session.',
      );
    }
    const result = await window.electronAPI.terminal.submitClaudeCliPrompt({
      sessionId,
      workspacePath,
      prompt,
      attachments,
    });
    if (!result.success) throw new Error('Failed to submit the Claude Code CLI prompt.');
    return;
  }

  const result = await window.electronAPI.invoke(
    'ai:sendMessage',
    prompt,
    {
      attachments: attachments.length > 0 ? attachments : undefined,
      mode,
      inputType: 'user',
    },
    sessionId,
    workspacePath,
  );
  if (result?.success === false) {
    throw new Error(result.error || 'Failed to start the session.');
  }
}

export const SessionLaunchPopup: React.FC<SessionLaunchPopupProps> = ({ workspacePath }) => {
  const requestVersion = useAtomValue(sessionLaunchPopupRequestAtom);
  const workspaceKey = workspacePath ?? '';
  const draftAtom = useMemo(() => sessionLaunchDraftAtom(workspaceKey), [workspaceKey]);
  const [draft, setDraft] = useAtom(draftAtom);
  const defaultModel = useAtomValue(defaultAgentModelAtom);
  const defaultEffortLevel = useAtomValue(defaultEffortLevelAtom);
  const defaultThinkingMode = useAtomValue(defaultThinkingModeAtom);
  const developerMode = useAtomValue(developerModeAtom);
  const sessionRegistry = useAtomValue(sessionRegistryAtom);
  const setAgentModeSettings = useSetAtom(setAgentModeSettingsAtom);
  const createNewSession = useSetAtom(createNewSessionActionAtom);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<AIInputRef>(null);
  const setDraftRef = useRef(setDraft);
  setDraftRef.current = setDraft;

  const selectedModel = draft.model ?? defaultModel;
  const parsedModel = selectedModel ? ModelIdentifier.tryParse(selectedModel) : null;
  const provider = parsedModel?.provider ?? 'claude-code';
  const effortLevel = draft.effortLevel ?? defaultEffortLevel;
  const thinkingMode = resolveThinkingMode(draft.thinkingMode, defaultThinkingMode);

  const ensurePendingSessionId = useCallback(() => {
    setDraftRef.current((current) => ({
      ...current,
      pendingSessionId: current.pendingSessionId ?? crypto.randomUUID(),
    }));
    setError(null);
  }, []);

  const [open, setOpen] = useLaunchPopupToggle(requestVersion, {
    enabled: Boolean(workspacePath),
    onBeforeOpen: ensurePendingSessionId,
  });

  useEffect(() => {
    if (!open) return;
    ensurePendingSessionId();
  }, [open, ensurePendingSessionId]);

  useEffect(() => {
    setOpen(false);
    setCreatedSessionId(null);
    setError(null);
  }, [workspacePath, setOpen]);

  const updateValue = useCallback((value: string) => {
    setDraft((current) => ({ ...current, value }));
  }, [setDraft]);

  const addAttachment = useCallback((attachment: ChatAttachment) => {
    setDraft((current) => ({
      ...current,
      attachments: [...current.attachments, attachment],
    }));
  }, [setDraft]);

  const removeAttachment = useCallback((attachmentId: string) => {
    setDraft((current) => ({
      ...current,
      attachments: current.attachments.filter((attachment) => attachment.id !== attachmentId),
    }));
  }, [setDraft]);

  const handleModelChange = useCallback((model: string) => {
    setDraft((current) => ({ ...current, model }));
    setAgentModeSettings({ defaultModel: model });
  }, [setDraft, setAgentModeSettings]);

  const handleEffortLevelChange = useCallback((nextEffort: EffortLevel) => {
    setDraft((current) => ({ ...current, effortLevel: nextEffort }));
    setAgentModeSettings({ defaultEffortLevel: nextEffort });
  }, [setDraft, setAgentModeSettings]);

  const handleThinkingModeChange = useCallback((nextThinkingMode: ThinkingMode) => {
    setDraft((current) => ({ ...current, thinkingMode: nextThinkingMode }));
    setAgentModeSettings({ defaultThinkingMode: nextThinkingMode });
  }, [setDraft, setAgentModeSettings]);

  const handleSend = useCallback(async () => {
    let prompt = draft.value.trim();

    // Denominator for the send wall, before every guard — see
    // shared/analytics/sendOutcomes.ts. This surface always starts a session's
    // first turn, so `isFirstMessageInSession` is unconditionally true here.
    const blocked = (reason: SendBlockedReason) =>
      trackSendWallEvent('ai_send_blocked', {
        surface: 'launch_popup',
        reason,
        provider: toStableAnalyticsCategory(provider),
      });

    trackSendWallEvent('ai_message_submit_attempted', {
      surface: 'launch_popup',
      provider: toStableAnalyticsCategory(provider),
      promptLengthBucket: bucketPromptLength(prompt.length),
      isFirstMessageInSession: true,
      sessionMode: toStableAnalyticsCategory(draft.mode),
    });

    if (!prompt) {
      blocked('empty_draft');
      return;
    }
    if (!workspacePath || !draft.pendingSessionId || !selectedModel || isSubmitting) {
      blocked('no_session_data');
      return;
    }

    let launchMode = draft.mode;
    const planCommand = prompt.match(/^\/plan(?:\s|$)/);
    if (planCommand) {
      launchMode = 'planning';
      prompt = prompt.slice(planCommand[0].length).trim();
      if (!prompt) {
        setError('Add instructions after /plan before starting the session.');
        blocked('slash_command_only');
        return;
      }
    }

    prompt = expandSessionMentions(prompt, sessionRegistry);
    setIsSubmitting(true);
    setError(null);

    try {
      let sessionId = createdSessionId;
      if (!sessionId) {
        sessionId = await createNewSession({
          sessionId: draft.pendingSessionId,
          model: selectedModel,
          mode: launchMode,
          selectSession: false,
          launchSource: 'launch_popup',
          metadata: {
            effortLevel,
            thinkingMode,
          },
        }) ?? null;
        if (!sessionId) throw new Error('Failed to create the session.');
        setCreatedSessionId(sessionId);
      }

      const backgroundLaunch = launchSessionPrompt({
        sessionId,
        workspacePath,
        provider,
        model: selectedModel,
        prompt,
        mode: launchMode,
        attachments: draft.attachments,
      });

      setDraft(createEmptySessionLaunchDraft());
      setCreatedSessionId(null);
      setOpen(false);

      void backgroundLaunch.catch((backgroundError) => {
        console.error('[SessionLaunchPopup] Background session failed:', backgroundError);
        errorNotificationService.showError(
          'Background session failed',
          backgroundError instanceof Error ? backgroundError.message : 'Failed to start the session.',
        );
      });
    } catch (launchError) {
      console.error('[SessionLaunchPopup] Failed to launch session:', launchError);
      setError(launchError instanceof Error ? launchError.message : 'Failed to start the session.');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    createNewSession,
    createdSessionId,
    draft,
    effortLevel,
    isSubmitting,
    provider,
    selectedModel,
    sessionRegistry,
    setDraft,
    thinkingMode,
    workspacePath,
  ]);

  if (!workspacePath) return null;

  return (
    <LaunchPopupShell
      open={open}
      onOpenChange={setOpen}
      title="Launch New Session"
      ariaLabel="Launch new session"
      closeLabel="Close session launch popup"
      classPrefix="session-launch-popup"
      resetKey={workspacePath}
      onOpened={() => inputRef.current?.focus()}
    >
      <AIInput
        ref={inputRef}
        value={draft.value}
        onChange={updateValue}
        onSend={() => void handleSend()}
        disabled={isSubmitting}
        isLoading={isSubmitting}
        placeholder="Ask or instruct..."
        workspacePath={workspacePath}
        sessionId={draft.pendingSessionId ?? undefined}
        attachments={draft.attachments}
        onAttachmentAdd={addAttachment}
        onAttachmentRemove={removeAttachment}
        enableSlashCommands
        mode={draft.mode}
        onModeChange={(mode) => setDraft((current) => ({ ...current, mode }))}
        currentModel={selectedModel}
        onModelChange={createdSessionId ? undefined : handleModelChange}
        readOnlyModel={Boolean(createdSessionId)}
        readOnlyModelTitle="This session was already created; retry to submit the prompt"
        sessionHasMessages={false}
        currentProvider={provider}
        effortLevel={effortLevel}
        onEffortLevelChange={handleEffortLevelChange}
        showEffortLevel={supportsEffortLevel(selectedModel)}
        thinkingMode={thinkingMode}
        onThinkingModeChange={handleThinkingModeChange}
        showThinkingToggle={developerMode && supportsThinkingToggle(selectedModel)}
        provider={provider}
        testId="session-launch-popup-input"
      />
      {error && (
        <div className="session-launch-popup-error select-text border-t border-[var(--nim-border)] px-3 py-2 text-xs text-[var(--nim-error)]" role="alert">
          {error}
        </div>
      )}
    </LaunchPopupShell>
  );
};

export default SessionLaunchPopup;
