/**
 * Inviting a teammate: who, what role, and what they get.
 *
 * The form this replaces was one email input and an Invite button, which is
 * why a new member could accept and land in an organization with nothing in
 * it. See `inviteToTeamModel.ts` for why "what they get" is two mechanisms
 * rather than one — projects are access, folders are content, and neither
 * substitutes for the other.
 *
 * Folders publish *after* the invitations are sent, and a publish failure
 * never fails the invitation: the membership is real either way, and the one
 * outcome to avoid is telling the inviter a teammate was not invited when they
 * were.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import {
  buildProjectGrants,
  inviteActionLabel,
  parseInviteEmails,
  summarizeInvitePlan,
  type InviteProjectOption,
  type InviteRole,
} from './inviteToTeamModel';
import { WorkspaceFolderPicker } from './WorkspaceFolderPicker';

const ROLE_OPTIONS: Array<{ value: InviteRole; label: string }> = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
  { value: 'viewer', label: 'Viewer' },
];

export interface InviteToTeamResult {
  invited: string[];
  failed: Array<{ email: string; error: string }>;
  /** `teamProjectId`s the server accepted the invite for but could not grant. */
  projectGrantsFailed: string[];
  foldersPublished: number;
  folderFailures: string[];
}

export interface InviteToTeamDialogProps {
  isOpen: boolean;
  orgId: string;
  orgName: string;
  /** Every project in the org, primary flagged. */
  projects: readonly InviteProjectOption[];
  /** The workspace whose folders can be published. Null hides that section. */
  workspacePath: string | null;
  onClose: () => void;
  onInvited: (result: InviteToTeamResult) => void;
}

export function InviteToTeamDialog({
  isOpen,
  orgId,
  orgName,
  projects,
  workspacePath,
  onClose,
  onInvited,
}: InviteToTeamDialogProps) {
  const [emailText, setEmailText] = useState('');
  const [role, setRole] = useState<InviteRole>('member');
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setEmailText('');
    setRole('member');
    setSelectedProjects(new Set());
    setSelectedFolders([]);
    setBusy(false);
    setError(null);
  }, [isOpen]);

  const { emails, invalid } = useMemo(() => parseInviteEmails(emailText), [emailText]);
  const extraProjects = useMemo(
    () => buildProjectGrants(projects, selectedProjects, role),
    [projects, role, selectedProjects],
  );
  const plan = {
    people: emails.length,
    extraProjects: extraProjects.length,
    folders: selectedFolders.length,
  };

  const toggleProject = useCallback((teamProjectId: string) => {
    setSelectedProjects((current) => {
      const next = new Set(current);
      if (next.has(teamProjectId)) next.delete(teamProjectId);
      else next.add(teamProjectId);
      return next;
    });
  }, []);

  const send = useCallback(async () => {
    if (emails.length === 0 || busy) return;
    setBusy(true);
    setError(null);

    const invited: string[] = [];
    const failed: InviteToTeamResult['failed'] = [];
    const projectGrantsFailed = new Set<string>();

    for (const email of emails) {
      try {
        const outcome = await window.electronAPI.organization.inviteMember(
          orgId,
          email,
          role,
          extraProjects.length > 0 ? extraProjects : undefined,
        );
        if (outcome?.success === false) {
          failed.push({ email, error: outcome.error ?? 'Could not send invitation' });
          continue;
        }
        invited.push(email);
        for (const teamProjectId of outcome?.projectGrantsFailed ?? []) {
          projectGrantsFailed.add(teamProjectId);
        }
      } catch (reason) {
        failed.push({ email, error: reason instanceof Error ? reason.message : String(reason) });
      }
    }

    // Publishing runs once for the team, not once per invitee: the folder goes
    // into the org's shared tree, and doing it per address would create N
    // copies of the same documents.
    let foldersPublished = 0;
    const folderFailures: string[] = [];
    if (invited.length > 0 && selectedFolders.length > 0) {
      const { publishFoldersForInvite } = await import('./publishFoldersForInvite');
      const outcome = await publishFoldersForInvite(selectedFolders);
      foldersPublished = outcome.published;
      folderFailures.push(...outcome.failures);
    }

    setBusy(false);
    if (invited.length === 0) {
      setError(failed[0]?.error ?? 'Could not send the invitations.');
      return;
    }
    onInvited({
      invited,
      failed,
      projectGrantsFailed: [...projectGrantsFailed],
      foldersPublished,
      folderFailures,
    });
    onClose();
  }, [busy, emails, extraProjects, onClose, onInvited, orgId, role, selectedFolders]);

  if (!isOpen) return null;

  const grantableProjects = projects.filter(project => !project.isPrimary);
  const primary = projects.find(project => project.isPrimary);

  return (
    <div className="invite-to-team-backdrop fixed inset-0 z-50 grid place-items-center bg-black/50 p-6">
      <section
        className="invite-to-team-dialog flex max-h-full w-[38rem] flex-col overflow-hidden rounded-lg border border-[var(--nim-border)] bg-[var(--nim-bg)] shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label={`Invite to ${orgName}`}
      >
        <header className="shrink-0 border-b border-[var(--nim-border)] px-5 py-4">
          <h2 className="m-0 text-base font-semibold text-[var(--nim-text)]">Invite to {orgName}</h2>
          <p className="m-0 mt-1 text-sm text-[var(--nim-text-muted)]">
            People you invite get access to what you pick here as soon as they accept.
          </p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          <label className="mt-4 block text-xs font-semibold uppercase tracking-wider text-[var(--nim-text-faint)]" htmlFor="invite-emails">
            Email addresses
          </label>
          <textarea
            id="invite-emails"
            className="mt-2 min-h-[3.5rem] w-full resize-y rounded border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] px-3 py-2 text-sm text-[var(--nim-text)]"
            value={emailText}
            placeholder="teammate@example.com, another@example.com"
            onChange={(event) => setEmailText(event.target.value)}
          />
          {invalid.length > 0 && (
            <p className="mt-1 text-xs text-[var(--nim-warning)]">
              Not an email address: {invalid.join(', ')}
            </p>
          )}

          <span className="mt-5 block text-xs font-semibold uppercase tracking-wider text-[var(--nim-text-faint)]">
            Role
          </span>
          <div className="mt-2 inline-flex overflow-hidden rounded border border-[var(--nim-border)]" role="group" aria-label="Role">
            {ROLE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={role === option.value}
                className={`border-0 px-4 py-2 text-sm ${
                  role === option.value
                    ? 'bg-[var(--nim-primary)] font-semibold text-[var(--nim-on-primary)]'
                    : 'bg-[var(--nim-bg-secondary)] text-[var(--nim-text-muted)]'
                }`}
                onClick={() => setRole(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <span className="mt-5 block text-xs font-semibold uppercase tracking-wider text-[var(--nim-text-faint)]">
            What they get
          </span>

          <div className="mt-2 rounded border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] p-3">
            <p className="m-0 flex items-center gap-2 text-sm text-[var(--nim-text)]">
              <MaterialSymbol icon="check_circle" size={16} className="text-[var(--nim-success)]" />
              {primary?.name || 'The team project'}
              <span className="text-xs text-[var(--nim-text-faint)]">granted automatically</span>
            </p>
            {grantableProjects.length > 0 && (
              <div className="mt-2 grid gap-1 border-t border-[var(--nim-border)] pt-2">
                {grantableProjects.map((project) => (
                  <label key={project.teamProjectId} className="flex items-center gap-2 text-sm text-[var(--nim-text)]">
                    <input
                      type="checkbox"
                      checked={selectedProjects.has(project.teamProjectId)}
                      onChange={() => toggleProject(project.teamProjectId)}
                    />
                    {project.name || project.teamProjectId}
                  </label>
                ))}
              </div>
            )}
          </div>

          {workspacePath && (
            <div className="mt-3">
              <p className="m-0 mb-2 text-xs text-[var(--nim-text-muted)]">
                Publish folders from this workspace so there is something to open. A publish is a
                one-time copy; files added later stay local.
              </p>
              <WorkspaceFolderPicker
                workspacePath={workspacePath}
                selected={selectedFolders}
                onToggle={(folderPath) => setSelectedFolders((current) => (
                  current.includes(folderPath)
                    ? current.filter(path => path !== folderPath)
                    : [...current, folderPath]
                ))}
              />
            </div>
          )}

          {plan.people > 0 && plan.extraProjects === 0 && plan.folders === 0 && (
            <p className="mt-3 text-xs text-[var(--nim-warning)]">
              They will arrive to an empty workspace. You can share folders with them later.
            </p>
          )}
          {error && <p className="mt-3 text-xs text-[var(--nim-error)]" role="alert">{error}</p>}
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-t border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] px-5 py-3">
          <span className="flex-1 text-sm text-[var(--nim-text-muted)]">{summarizeInvitePlan(plan)}</span>
          <button
            type="button"
            className="rounded border border-[var(--nim-border)] bg-[var(--nim-bg-tertiary)] px-3 py-2 text-sm text-[var(--nim-text-muted)]"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded bg-[var(--nim-primary)] px-3 py-2 text-sm font-semibold text-[var(--nim-on-primary)] disabled:opacity-50"
            onClick={() => void send()}
            disabled={busy || emails.length === 0}
          >
            {busy ? 'Sending…' : inviteActionLabel(plan)}
          </button>
        </footer>
      </section>
    </div>
  );
}
