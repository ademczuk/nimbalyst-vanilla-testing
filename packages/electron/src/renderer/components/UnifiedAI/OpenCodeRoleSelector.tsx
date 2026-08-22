import React, { useCallback, useEffect, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import { FloatingPortal, useFloatingMenu } from '../../hooks/useFloatingMenu';
import type { OpenCodeAgentSummary } from '../../../shared/openCodeAgentCatalog';
import {
  describeRoleOrigin,
  findRoleModelConflict,
  shouldShowRoleSelector,
  summarizeRolePermissions,
} from './openCodeRoles';

interface OpenCodeRoleSelectorProps {
  workspacePath: string;
  /** Role name from session metadata; null means OpenCode's own default agent. */
  role: string | null;
  onRoleChange: (role: string | null) => void;
  /** Session model id, used to detect a role configured for a different model. */
  currentModel?: string | null;
  /** Lets the conflict banner adopt the role's model. Omitted = banner is read-only. */
  onModelChange?: (modelId: string) => void;
  /**
   * Whether a turn is running for this session. Only its transitions matter:
   * a turn is what starts (and keeps alive) the OpenCode server this control
   * discovers roles from.
   */
  turnActive?: boolean;
}

/**
 * Per-session OpenCode role picker.
 *
 * OpenCode agents are permission-scoped personas, not skills: each one carries
 * its own prompt, tool allowlist and permission policy, and `mode: primary`
 * (or `all`) means it can be the role a session runs as. The selection is
 * per-session state alongside the model, and is applied to every prompt, so
 * switching roles mid-conversation takes effect on the next turn.
 */
export function OpenCodeRoleSelector({
  workspacePath,
  role,
  onRoleChange,
  currentModel,
  onModelChange,
  turnActive = false,
}: OpenCodeRoleSelectorProps) {
  const [agents, setAgents] = useState<OpenCodeAgentSummary[]>([]);
  const menu = useFloatingMenu({ placement: 'top-start', offsetPx: 4 });
  const { isOpen, setIsOpen } = menu;

  const loadAgents = useCallback(async () => {
    if (!workspacePath) return;
    try {
      // Read-only and opportunistic: the catalog answers from a server that is
      // already running and never starts `opencode serve` itself.
      const response = await window.electronAPI.openCodeAgentCatalogGet({ workspacePath });
      // A snapshot from before any server has answered carries no roles. Taking
      // it would blank a list discovered earlier -- the server having gone away
      // does not retract the roles it reported, and the user's selection is
      // still sent with every prompt.
      if (response.success && response.catalog.discovered) {
        setAgents(response.catalog.agents);
      }
    } catch (error) {
      console.error('[OpenCodeRoleSelector] Failed to load roles:', error);
    }
  }, [workspacePath]);

  // Roles are discovered from a running OpenCode server, and the first turn is
  // what starts one. Reading only on mount meant the control was still hidden
  // when the roles arrived and only appeared after an unrelated remount, so the
  // ordinary path -- open a session, send a prompt -- never showed it. Both
  // edges of a turn are worth a read: the start is when a server appears, the
  // end is when it has certainly answered.
  useEffect(() => { void loadAgents(); }, [loadAgents, turnActive]);
  // Re-reading on open keeps a role the user just added in their config from
  // needing an app restart.
  useEffect(() => { if (isOpen) void loadAgents(); }, [isOpen, loadAgents]);

  const conflict = findRoleModelConflict(role, agents, currentModel);

  if (!shouldShowRoleSelector(agents.length, role)) {
    return null;
  }

  const select = (next: string | null) => {
    onRoleChange(next);
    setIsOpen(false);
  };

  return (
    <div className="opencode-role-selector relative inline-block">
      <button
        ref={menu.refs.setReference}
        {...menu.getReferenceProps()}
        data-testid="opencode-role-selector"
        className={`flex items-center gap-1 px-2 py-[3px] rounded-xl text-[11px] font-medium transition-all duration-200 outline-none whitespace-nowrap cursor-pointer bg-[var(--nim-bg-secondary)] text-[var(--nim-text-muted)] border border-[var(--nim-border)] hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)]`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label={role ? `Session role: ${role}` : 'Session role'}
        title={conflict
          ? `This role is configured for ${conflict.roleModelLabel}, but the session model runs instead`
          : undefined}
      >
        <MaterialSymbol icon="badge" size={12} />
        <span>{role ?? 'Role'}</span>
        {conflict && (
          <MaterialSymbol
            icon="error"
            size={12}
            className="text-[var(--nim-warning)]"
          />
        )}
        <MaterialSymbol
          icon="expand_more"
          size={14}
          className={`transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <FloatingPortal>
          <div
            ref={menu.refs.setFloating}
            style={menu.floatingStyles}
            {...menu.getFloatingProps()}
            className="opencode-role-selector-menu min-w-[260px] max-w-[340px] overflow-y-auto rounded-lg p-1 z-[1000] bg-[var(--nim-bg)] border border-[var(--nim-border)] shadow-[0_4px_12px_rgba(0,0,0,0.15)]"
          >
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--nim-text-muted)]">
              Session role
            </div>

            <RoleOption
              label="Default"
              description="Run as OpenCode's own default agent."
              selected={!role}
              onSelect={() => select(null)}
            />

            {agents.map((agent) => (
              <RoleOption
                key={agent.name}
                label={agent.name}
                description={agent.description}
                origin={describeRoleOrigin(agent)}
                permissions={summarizeRolePermissions(agent)}
                selected={agent.name === role}
                onSelect={() => select(agent.name)}
              />
            ))}

            {conflict && (
              <div className="opencode-role-model-conflict mt-1 border-t border-[var(--nim-border)] px-2 py-2 text-[11px] text-[var(--nim-text-muted)] select-text">
                <div>
                  This role is configured for <span className="text-[var(--nim-text)]">{conflict.roleModelLabel}</span>.
                  The session&apos;s own model is sent with every prompt and takes precedence, so that is what runs.
                </div>
                {onModelChange && (
                  <button
                    className="mt-1.5 px-2 py-1 rounded border border-[var(--nim-border)] text-[var(--nim-text)] cursor-pointer hover:bg-[var(--nim-bg-hover)] hover:border-[var(--nim-primary)]"
                    onClick={() => {
                      onModelChange(conflict.roleModelId);
                      setIsOpen(false);
                    }}
                  >
                    Switch session to {conflict.roleModelLabel}
                  </button>
                )}
              </div>
            )}
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}

function RoleOption({
  label,
  description,
  origin,
  permissions,
  selected,
  onSelect,
}: {
  label: string;
  description?: string;
  /** Built-in vs config-defined. Omitted for the synthetic "Default" entry. */
  origin?: { label: string; title: string };
  permissions?: string[];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`opencode-role-option flex items-start justify-between gap-2 px-2 py-1.5 w-full border-none rounded text-xs cursor-pointer transition-[background] duration-150 text-left text-[var(--nim-text)] hover:bg-[var(--nim-bg-hover)] ${selected ? 'bg-[var(--nim-bg-secondary)]' : ''}`}
      onClick={onSelect}
    >
      <span className="min-w-0">
        <span className={selected ? 'text-[var(--nim-primary)]' : undefined}>{label}</span>
        {origin && (
          <span
            className="opencode-role-origin ml-1.5 px-1 py-px rounded align-middle text-[9px] uppercase tracking-wide text-[var(--nim-text-muted)] bg-[var(--nim-bg-secondary)] border border-[var(--nim-border)]"
            title={origin.title}
          >
            {origin.label}
          </span>
        )}
        {description && (
          <span className="block text-[11px] leading-snug text-[var(--nim-text-muted)] line-clamp-2">
            {description}
          </span>
        )}
        {permissions && permissions.length > 0 && (
          <span className="block text-[10px] text-[var(--nim-text-muted)] mt-0.5">
            {permissions.join(' · ')}
          </span>
        )}
      </span>
      {selected && <MaterialSymbol icon="check" size={14} className="shrink-0 mt-0.5" />}
    </button>
  );
}
