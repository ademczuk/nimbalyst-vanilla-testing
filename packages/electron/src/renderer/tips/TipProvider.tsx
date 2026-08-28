/**
 * TipProvider Component
 *
 * Evaluates tip trigger conditions on a timer and selects the highest-priority
 * eligible tip.
 *
 * Rendering policy (current):
 *   Tips are rendered inline in the empty panel of new AI sessions via
 *   `InlineTipDisplay` -- the floating bottom-left card from `TipCard` is
 *   intentionally not rendered here. The floating implementation is kept
 *   intact for a future surface. Tips persist once shown and are browsed via
 *   the inline "Next" / "All tips" controls; there is no dismiss and no
 *   one-per-launch cooldown. Activation is gated on
 *   `emptyTranscriptVisibleCountAtom > 0` so a tip only activates when there
 *   is an inline surface to render it.
 *
 * Shares persistence with the walkthrough system -- tip completed state is
 * stored alongside walkthrough state via the same IPC channels.
 */

import React, { useEffect, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { usePostHog } from 'posthog-js/react';
import type { ContentMode, TipDefinition, TipTriggerContext } from './types';
import { activeTipIdAtom } from './atoms';
import { walkthroughStateAtom, isWalkthroughActiveAtom } from '../walkthroughs/atoms';
import { hasActiveDialogsAtom } from '../contexts/DialogContext';
import { hasVisibleOverlay, getWalkthroughState } from '../walkthroughs/WalkthroughService';
import { store } from '@nimbalyst/runtime/store';
import { shouldShowTip, tipLastShownAt, markTipCompleted, recordTipShown, registerTipMenuEntries } from './TipService';
import { tips } from './definitions';
import {
  tipTriggerCommandAtom,
  tipResetCommandAtom,
} from '../store/atoms/walkthroughCommands';
import { errorNotificationService } from '../services/ErrorNotificationService';
import { worktreesFeatureAvailableAtom } from '../store/atoms/appSettings';
import { emptyTranscriptVisibleCountAtom } from './atoms';
import type { FeatureUsageRecord } from '../../shared/featureUsage';
import { tipTargetsScreen } from './filesEmptyTipSelection';

interface TipProviderProps {
  children: ReactNode;
  currentMode: ContentMode;
  workspacePath?: string;
}

export function TipProvider({ children, currentMode, workspacePath }: TipProviderProps) {
  const posthog = usePostHog();

  const walkthroughState = useAtomValue(walkthroughStateAtom);
  const isWalkthroughActive = useAtomValue(isWalkthroughActiveAtom);
  const hasActiveDialogs = useAtomValue(hasActiveDialogsAtom);
  const isWorktreesAvailable = useAtomValue(worktreesFeatureAvailableAtom);
  const emptyTranscriptVisibleCount = useAtomValue(emptyTranscriptVisibleCountAtom);
  const hasEmptyTranscriptSurface = emptyTranscriptVisibleCount > 0;

  const [activeTipId, setActiveTipId] = useAtom(activeTipIdAtom);
  const [featureUsage, setFeatureUsage] = useState<Record<string, FeatureUsageRecord>>({});
  const [toolUsage, setToolUsage] = useState<Record<string, FeatureUsageRecord>>({});
  const [isGitRepo, setIsGitRepo] = useState(false);

  // Refs for values the evaluation function reads. Keeping them in refs lets
  // the stable `evaluate` callback read the latest values without being
  // recreated on every change.
  const walkthroughStateRef = useRef(walkthroughState);
  const isWalkthroughActiveRef = useRef(isWalkthroughActive);
  const hasActiveDialogsRef = useRef(hasActiveDialogs);
  const activeTipIdRef = useRef(activeTipId);
  const currentModeRef = useRef(currentMode);
  const isWorktreesAvailableRef = useRef(isWorktreesAvailable);
  const workspacePathRef = useRef(workspacePath);

  // Keep refs in sync on every render
  walkthroughStateRef.current = walkthroughState;
  isWalkthroughActiveRef.current = isWalkthroughActive;
  hasActiveDialogsRef.current = hasActiveDialogs;
  activeTipIdRef.current = activeTipId;
  currentModeRef.current = currentMode;
  isWorktreesAvailableRef.current = isWorktreesAvailable;
  workspacePathRef.current = workspacePath;

  useEffect(() => {
    if (!hasEmptyTranscriptSurface) return undefined;

    let cancelled = false;

    const loadTipUsage = async () => {
      const [nextFeatureUsage, nextToolUsage] = await Promise.all([
        window.electronAPI.featureUsage.getAll().catch(() => ({})),
        Promise.resolve(window.electronAPI.toolUsage?.getRollup())
          .then((usage) => usage ?? {})
          .catch(() => ({})),
      ]);

      if (!cancelled) {
        setFeatureUsage(nextFeatureUsage);
        setToolUsage(nextToolUsage);
      }
    };

    void loadTipUsage();

    return () => {
      cancelled = true;
    };
  }, [hasEmptyTranscriptSurface]);

  useEffect(() => {
    let cancelled = false;

    const loadGitRepoStatus = async () => {
      if (!workspacePath || !window.electronAPI?.invoke) {
        setIsGitRepo(false);
        return;
      }

      try {
        const result = await window.electronAPI.invoke('git:is-repo', workspacePath);
        if (!cancelled) {
          setIsGitRepo(Boolean(result?.success && result.isRepo));
        }
      } catch {
        if (!cancelled) {
          setIsGitRepo(false);
        }
      }
    };

    loadGitRepoStatus();
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  const buildTriggerContext = useCallback((): TipTriggerContext => {
    return {
      currentMode: currentModeRef.current,
      workspacePath: workspacePathRef.current,
      isGitRepo,
      isWorktreesAvailable: isWorktreesAvailableRef.current,
      featureUsage,
      hasBeenUsed: (feature: string) => (featureUsage[feature]?.count ?? 0) > 0,
      hasReachedCount: (feature: string, threshold: number) =>
        (featureUsage[feature]?.count ?? 0) >= threshold,
      toolUsage,
      hasUsedTool: (toolKey: string) => (toolUsage[toolKey]?.count ?? 0) > 0,
      toolUseCount: (toolKey: string) => toolUsage[toolKey]?.count ?? 0,
    };
  }, [featureUsage, isGitRepo, toolUsage]);

  // Get active tip definition
  const activeTip = useMemo(() => {
    if (!activeTipId) return null;
    return tips.find((t) => t.id === activeTipId) ?? null;
  }, [activeTipId]);

  // Show a tip
  const showTip = useCallback(
    (tip: TipDefinition) => {
      // console.log(`[Tips] Showing: ${tip.id}`);
      setActiveTipId(tip.id);

      // Reload after recording so `history[id].shownAt` is visible to the next
      // evaluation. `recordTipShown` only writes main-process state; without the
      // reload the rotation tie-break would keep reading a stale history for the
      // rest of the run and re-pick the tip it just showed.
      //
      // Only overwrite the atom with a state we actually got back. Writing an
      // undefined result would trip the `!walkthroughStateRef.current` guard in
      // evaluate() and silently switch every tip off for the rest of the run.
      void (async () => {
        try {
          await recordTipShown(tip.id, tip.version);
          const refreshed = await getWalkthroughState();
          if (refreshed) store.set(walkthroughStateAtom, refreshed);
        } catch {
          // Rotation falls back to definition order until the next launch,
          // which reloads this state anyway.
        }
      })();

      posthog?.capture('tip_shown', {
        tip_id: tip.id,
        tip_name: tip.name,
      });
    },
    [posthog, setActiveTipId]
  );

  // Stable ref for showTip so eligibility evaluation can call it
  const showTipRef = useRef(showTip);
  showTipRef.current = showTip;

  // Handle primary action click
  const handleAction = useCallback(() => {
    if (!activeTip?.content.action) return;

    posthog?.capture('tip_action_clicked', {
      tip_id: activeTip.id,
      tip_name: activeTip.name,
      action_label: activeTip.content.action.label,
    });

    activeTip.content.action.onClick?.();
    markTipCompleted(activeTip.id, activeTip.version);
    setActiveTipId(null);
  }, [activeTip, posthog, setActiveTipId]);

  // Handle secondary action click
  const handleSecondaryAction = useCallback(() => {
    if (!activeTip?.content.secondaryAction) return;

    posthog?.capture('tip_action_clicked', {
      tip_id: activeTip.id,
      tip_name: activeTip.name,
      action_label: activeTip.content.secondaryAction.label,
      action_type: 'secondary',
    });

    activeTip.content.secondaryAction.onClick?.();
    // Secondary action doesn't dismiss the tip
  }, [activeTip, posthog]);

  // Evaluate eligibility and show the highest-priority eligible tip. Synchronous
  // and idempotent (the activeTipId guard prevents replacing a shown tip), so it
  // is safe to call from any trigger. Mutable state is read from refs.
  const evaluate = useCallback(() => {
    if ((window as any).PLAYWRIGHT) return;
    if (!walkthroughStateRef.current) return;
    if (isWalkthroughActiveRef.current) return;
    if (hasActiveDialogsRef.current || hasVisibleOverlay()) return;
    if (activeTipIdRef.current) return;
    // Nowhere to render: tips show inline in the empty panel of new AI
    // sessions, so only activate while such a surface is mounted.
    if (store.get(emptyTranscriptVisibleCountAtom) <= 0) return;

    const state = walkthroughStateRef.current;
    const mode = currentModeRef.current;
    const triggerContext = buildTriggerContext();

    const eligible = tips
      .filter((tip) => {
        if (!shouldShowTip(state, tip)) return false;
        const screenMatch = tipTargetsScreen(tip, mode);
        if (!screenMatch) return false;
        if (!tip.trigger.condition(triggerContext)) return false;
        return true;
      })
      .sort((a, b) => {
        const byPriority = (b.trigger.priority ?? 0) - (a.trigger.priority ?? 0);
        if (byPriority !== 0) return byPriority;
        // Rotate within a priority band. Sorting by priority alone is stable, so
        // ties resolved to definition order and the same tip won every time --
        // a tip sitting behind an equal-priority neighbour could never surface,
        // because nothing retires the winner except the user completing it.
        // Never-shown sorts first, then oldest `shownAt`, so showing a tip sends
        // it to the back of its band.
        return tipLastShownAt(state, a.id) - tipLastShownAt(state, b.id);
      });

    if (eligible.length > 0) {
      showTipRef.current(eligible[0]);
    }
  }, [buildTriggerContext]);

  // Immediate, reactive evaluation -- runs on mount and whenever a gating input
  // changes (an empty transcript appears, the active tip clears after an action,
  // or walkthrough/dialog state changes). No startup delay: a tip is empty-space
  // content and should fill the space at once, not 15 seconds later. The
  // activeTipId guard inside evaluate() makes the post-show re-run a no-op.
  useEffect(() => {
    evaluate();
  }, [evaluate, emptyTranscriptVisibleCount, activeTipId, walkthroughState, isWalkthroughActive, hasActiveDialogs]);

  // Register tip metadata with main process for Developer menu
  useEffect(() => {
    registerTipMenuEntries(
      tips.map((t) => ({ id: t.id, name: t.name }))
    );
  }, []);

  // React to tip trigger commands from Developer menu
  const triggerCommand = useAtomValue(tipTriggerCommandAtom);
  const triggerCommandProcessedRef = useRef<number | null>(null);

  useEffect(() => {
    if (!triggerCommand || triggerCommand.timestamp === triggerCommandProcessedRef.current) return;
    triggerCommandProcessedRef.current = triggerCommand.timestamp;

    const { tipId } = triggerCommand;
    const tip = tips.find((t) => t.id === tipId);
    if (!tip) {
      errorNotificationService.showInfo(
        'Unknown Tip',
        `Tip "${tipId}" not found.`,
        { duration: 3000 }
      );
      return;
    }

    // Force-show the tip, bypassing cooldown and condition checks
    setActiveTipId(tip.id);
    recordTipShown(tip.id, tip.version);
    posthog?.capture('tip_shown', {
      tip_id: tip.id,
      tip_name: tip.name,
      source: 'developer_menu',
    });
  }, [triggerCommand, setActiveTipId, posthog]);

  // React to tip reset commands from Developer menu
  const resetCommand = useAtomValue(tipResetCommandAtom);
  const resetCommandProcessedRef = useRef<number>(0);

  useEffect(() => {
    if (resetCommand === 0 || resetCommand === resetCommandProcessedRef.current) return;
    resetCommandProcessedRef.current = resetCommand;

    (async () => {
      // Reset only tip state (tip- prefixed entries), not walkthroughs
      await window.electronAPI.invoke('tips:reset');
      // Reload state so tips can show again
      const newState = await getWalkthroughState();
      store.set(walkthroughStateAtom, newState);
      setActiveTipId(null);
      errorNotificationService.showInfo(
        'Tips Reset',
        'All tips will show again.',
        { duration: 3000 }
      );
    })();
  }, [resetCommand, setActiveTipId]);

  // Dev helpers
  useEffect(() => {
    if (import.meta.env.DEV) {
      const helpers = {
        listTips: () => {
          const triggerContext = buildTriggerContext();
          console.table(
            tips.map((t) => ({
              id: t.id,
              name: t.name,
              screen: t.trigger.screen,
              priority: t.trigger.priority,
              conditionMet: t.trigger.condition(triggerContext),
            }))
          );
          return tips.map((t) => t.id);
        },
        showTip: (id: string) => {
          const tip = tips.find((t) => t.id === id);
          if (tip) showTip(tip);
          else console.warn(`[Tips] Unknown tip ID: ${id}`);
        },
        getState: () => ({
          activeTipId,
          walkthroughState,
        }),
      };

      (window as any).__tipHelpers = helpers;

      return () => {
        delete (window as any).__tipHelpers;
      };
    }
    return undefined;
  }, [activeTipId, walkthroughState, showTip]);

  // Rendering policy: the floating TipCard is intentionally not rendered
  // here. Tips show inline in the empty panel of new AI sessions via
  // `InlineTipDisplay` (see SessionTranscript's `renderEmptyExtra`). The
  // floating implementation is preserved in TipCard for future use.
  return <>{children}</>;
}
