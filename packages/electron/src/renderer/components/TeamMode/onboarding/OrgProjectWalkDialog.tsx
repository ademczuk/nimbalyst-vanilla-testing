/**
 * Post-sign-in project walk.
 *
 * An invited teammate's organization lives on their account, but the org a
 * project window shows is resolved from the workspace's git remote. Someone who
 * signs in and opens an unrelated folder is therefore told they have no
 * organization. This walks them into one of the org's projects so that lookup
 * has something to match.
 *
 * Three steps: introduce, pick a project, get a folder for it. The folder step
 * either clones the project's repository or points at a folder the user already
 * has; when the project has no recorded repository address the clone option is
 * explained rather than hidden, so it is obvious why it is unavailable and who
 * can fix it.
 *
 * Every rule it applies (what a folder can be used for, why a clone failed)
 * lives in `shared/orgProjectWalk.ts`; this file renders them.
 *
 * See nimbalyst-local/plans/simpler-org-signup-flow.md (Item 3).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';

import {
  type CloneFailureKind,
  type ProjectFolderVerdict,
  type ProjectWalkOrg,
} from '../../../../shared/orgProjectWalk';
import { orgProjectCloneProgressAtom } from '../../../store/atoms/orgProjectWalk';
import { orgAvatarColor, orgAvatarInitials } from './orgWizardModel';
import { markOrgProjectWalkDismissed } from './orgOnboardingStorage';

/** How the walk ended. A named seam for the funnel a sibling session wires. */
export type ProjectWalkOutcome =
  | { completed: false; skipped: true }
  | { completed: true; folderSource: 'clone' | 'bind' };

export interface OrgProjectWalkProject {
  projectId: string;
  teamProjectId: string;
  name: string | null;
  slug: string | null;
  gitRemoteHash: string | null;
  remoteUrl?: string;
  localStatus: 'open' | 'closed' | 'notLocal';
  workspacePath: string | null;
}

export interface OrgProjectWalkDialogProps {
  isOpen: boolean;
  onClose: () => void;
  org: ProjectWalkOrg;
  /** Reported when the walk ends, either way. Analytics attaches here. */
  onFinished?: (outcome: ProjectWalkOutcome) => void;
}

type Step = 'intro' | 'project' | 'folder' | 'cloning' | 'done';

const api = () => (window as { electronAPI?: any }).electronAPI;

function projectLabel(project: OrgProjectWalkProject | null): string {
  if (!project) return 'this project';
  return project.name || project.slug || 'Untitled project';
}

function statusChip(status: OrgProjectWalkProject['localStatus']): { label: string; className: string } {
  switch (status) {
    case 'open':
      return { label: 'Open', className: 'bg-[color-mix(in_srgb,var(--nim-success)_16%,transparent)] text-[var(--nim-success)]' };
    case 'closed':
      return { label: 'On this computer', className: 'bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)]' };
    default:
      return { label: 'Not on this computer', className: 'bg-[color-mix(in_srgb,var(--nim-warning)_16%,transparent)] text-[var(--nim-warning)]' };
  }
}

/** What went wrong with a clone, in words the user can act on. */
function cloneFailureCopy(kind: CloneFailureKind, remote: string): { title: string; body: string } {
  switch (kind) {
    case 'auth':
      return {
        title: "Couldn't access the repository",
        body: `Git could not authenticate to ${remote}. Nimbalyst uses your existing git credentials — set them up, or clone it yourself and choose the folder.`,
      };
    case 'network':
      return {
        title: "Couldn't reach the repository",
        body: `${remote} could not be reached. Check your connection, or clone it yourself and choose the folder.`,
      };
    case 'cancelled':
      return { title: 'Clone cancelled', body: 'Nothing was changed. Start again, or choose a folder you already have.' };
    default:
      return {
        title: "Couldn't clone the repository",
        body: `Git could not clone ${remote}. Clone it yourself and choose the folder instead.`,
      };
  }
}

/** Why a chosen folder can't be used, and what to do about it. */
function folderRefusalCopy(
  verdict: ProjectFolderVerdict,
  directoryPath: string,
  label: string,
): { title: string; body: string; tone: 'warning' | 'error' } | null {
  switch (verdict.kind) {
    case 'occupied':
      return {
        tone: 'warning',
        title: "That folder isn't empty",
        body: `${directoryPath} already contains files that aren't part of ${label}. Choose an empty folder, or a new one inside it.`,
      };
    case 'wrongRemote':
      return {
        tone: 'error',
        title: "That folder belongs to a different repository",
        body: `${directoryPath} has a git remote that doesn't match ${label}. Choose the folder you cloned ${label} into.`,
      };
    case 'notADirectory':
      return { tone: 'error', title: 'That path is a file', body: `${directoryPath} is not a folder.` };
    default:
      return null;
  }
}

export function OrgProjectWalkDialog({ isOpen, onClose, org, onFinished }: OrgProjectWalkDialogProps) {
  const [step, setStep] = useState<Step>('intro');
  const [projects, setProjects] = useState<OrgProjectWalkProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [mode, setMode] = useState<'clone' | 'choose'>('clone');
  const [directoryPath, setDirectoryPath] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<ProjectFolderVerdict | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cloneFailure, setCloneFailure] = useState<{ kind: CloneFailureKind; detail: string } | null>(null);
  const [cloneId, setCloneId] = useState<string | null>(null);
  const cloneIdRef = useRef<string | null>(null);
  const cloneProgress = useAtomValue(orgProjectCloneProgressAtom);
  const progress = cloneProgress?.cloneId === cloneId ? cloneProgress : null;

  const selectedProject = useMemo(
    () => projects.find((project) => project.teamProjectId === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const label = projectLabel(selectedProject);
  const canClone = !!selectedProject?.remoteUrl;

  useEffect(() => {
    if (!isOpen || step !== 'project' || projects.length > 0) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void api()?.team?.resolveOrgProjectsLocalState?.(org.orgId)
      .then((result: any) => {
        if (cancelled) return;
        if (!result?.success) throw new Error(result?.error ?? 'Could not load projects');
        const rows: OrgProjectWalkProject[] = result.projects ?? [];
        setProjects(rows);
        // Preselect something that needs a folder, so the common case is one
        // click; a project already open here is not what the walk is for.
        setSelectedProjectId(
          (rows.find((row) => row.localStatus === 'notLocal') ?? rows[0])?.teamProjectId ?? null,
        );
      })
      .catch((reason: unknown) => {
        if (!cancelled) setLoadError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, step, projects.length, org.orgId]);

  // A project with no recorded repository address can only be pointed at a
  // folder, so the folder step must not open on an option that cannot run.
  useEffect(() => {
    if (step === 'folder') setMode(canClone ? 'clone' : 'choose');
  }, [step, canClone]);

  const dismiss = useCallback((reason: 'skip' | 'done' | 'background') => {
    // 'background' is not a rejection: the clone is still running and will open
    // the project when it lands, so it neither silences the walk nor counts as
    // a skip.
    if (reason === 'skip') {
      void markOrgProjectWalkDismissed(org.orgId);
      onFinished?.({ completed: false, skipped: true });
    }
    onClose();
  }, [onClose, onFinished, org.orgId]);

  const browse = useCallback(async () => {
    setActionError(null);
    setCloneFailure(null);
    const selection = await api()?.invoke?.('dialog:openDirectory', {
      title: mode === 'clone' ? `Choose where to clone ${label}` : `Choose the folder for ${label}`,
      buttonLabel: mode === 'clone' ? 'Clone Here' : 'Use This Folder',
    });
    const chosen = selection?.filePaths?.[0];
    if (!chosen || !selectedProject) return;
    setDirectoryPath(chosen);

    const inspected = await api()?.team?.inspectProjectFolder?.({
      orgId: org.orgId,
      teamProjectId: selectedProject.teamProjectId,
      directoryPath: chosen,
    });
    setVerdict(inspected?.success ? inspected.verdict : null);
    if (!inspected?.success) setActionError(inspected?.error ?? 'Could not inspect that folder');
    // The happy accident: they already have the repository. Bind it rather than
    // cloning a second copy.
    if (inspected?.verdict?.kind === 'alreadyCloned') setMode('choose');
  }, [mode, label, selectedProject, org.orgId]);

  const openProject = useCallback(async (workspacePath: string, folderSource: 'clone' | 'bind') => {
    await api()?.team?.openProjectWorkspace?.(workspacePath);
    onFinished?.({ completed: true, folderSource });
    setStep('done');
  }, [onFinished]);

  const join = useCallback(async (folderSource: 'clone' | 'bind') => {
    if (!selectedProject || !directoryPath) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await api()?.team?.joinProjectFolder?.({
        orgId: org.orgId,
        teamProjectId: selectedProject.teamProjectId,
        directoryPath,
      });
      if (!result?.success) {
        setActionError(result?.error ?? 'Could not use that folder');
        return;
      }
      await openProject(result.workspacePath, folderSource);
    } finally {
      setBusy(false);
    }
  }, [selectedProject, directoryPath, org.orgId, openProject]);

  const startClone = useCallback(async () => {
    if (!selectedProject?.remoteUrl || !directoryPath) return;
    const id = `clone-${selectedProject.teamProjectId}-${Date.now()}`;
    cloneIdRef.current = id;
    setCloneId(id);
    setCloneFailure(null);
    setActionError(null);
    setStep('cloning');
    const result = await api()?.team?.cloneProject?.({
      cloneId: id,
      remoteUrl: selectedProject.remoteUrl,
      directoryPath,
    });
    cloneIdRef.current = null;
    if (!result?.success) {
      setCloneFailure({
        kind: (result?.failureKind ?? 'unknown') as CloneFailureKind,
        detail: result?.error ?? '',
      });
      setStep('folder');
      return;
    }
    await join('clone');
  }, [selectedProject, directoryPath, join]);

  const cancelClone = useCallback(() => {
    if (cloneIdRef.current) void api()?.team?.cancelProjectClone?.(cloneIdRef.current);
  }, []);

  if (!isOpen) return null;

  const avatar = (name: string, size: 'sm' | 'md') => (
    <span
      className={`org-project-walk-avatar flex shrink-0 items-center justify-center rounded-md font-semibold text-white ${size === 'md' ? 'h-9 w-9 text-[13px]' : 'h-6 w-6 text-[10px]'}`}
      style={{ backgroundColor: orgAvatarColor(name) }}
      aria-hidden="true"
    >
      {orgAvatarInitials(name)}
    </span>
  );

  const stepNumber = step === 'intro' ? 1 : step === 'project' ? 2 : 3;

  return (
    <div
      className="org-project-walk-overlay fixed inset-0 z-[10000] flex items-center justify-center bg-black/60"
      data-testid="org-project-walk-overlay"
      onClick={(event) => { if (event.target === event.currentTarget) dismiss('skip'); }}
    >
      <div
        className="org-project-walk w-[520px] max-w-[92vw] overflow-hidden rounded-xl border border-[var(--nim-border)] bg-[var(--nim-bg)] shadow-2xl"
        data-component="OrgProjectWalkDialog"
        data-testid="org-project-walk"
        data-step={step}
        role="dialog"
        aria-modal="true"
        aria-label={`Join a project in ${org.name}`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="org-project-walk-header flex items-start gap-3 border-b border-[var(--nim-border)] px-5 py-4">
          {avatar(step === 'intro' || step === 'project' ? org.name : label, step === 'intro' ? 'md' : 'sm')}
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-[var(--nim-text)]">
              {step === 'intro' && `You're a member of ${org.name}`}
              {step === 'project' && 'Choose a project'}
              {(step === 'folder' || step === 'cloning') && `Get a folder for ${label}`}
              {step === 'done' && `You're in ${label}`}
            </div>
            <div className="mt-0.5 text-[12px] text-[var(--nim-text-muted)]">
              {step === 'project'
                ? `${projects.length} project${projects.length === 1 ? '' : 's'} in ${org.name}`
                : step === 'done'
                  ? `${org.name} · ${directoryPath ?? ''}`
                  : org.name}
            </div>
          </div>
          {step !== 'done' && (
            <button
              type="button"
              className="org-project-walk-dismiss flex h-6 w-6 items-center justify-center rounded text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]"
              data-testid="org-project-walk-dismiss"
              aria-label="Close — you can join the project later from the organization menu"
              onClick={() => dismiss('skip')}
            >
              <MaterialSymbol icon="close" size={14} />
            </button>
          )}
        </header>

        {(step === 'project' || step === 'folder') && (
          <div
            className="org-project-walk-steps flex items-center gap-2 border-b border-[var(--nim-border)] px-5 py-2.5 text-[11px] text-[var(--nim-text-faint)]"
            data-testid="org-project-walk-steps"
          >
            <span>Organization</span>
            <span className="h-px flex-1 bg-[var(--nim-border)]" />
            <span className={stepNumber >= 2 ? 'text-[var(--nim-text)]' : undefined}>Project</span>
            <span className="h-px flex-1 bg-[var(--nim-border)]" />
            <span className={stepNumber >= 3 ? 'text-[var(--nim-text)]' : undefined}>Folder</span>
          </div>
        )}

        <div className="org-project-walk-body px-5 py-4">
          {step === 'intro' && (
            <>
              <p className="m-0 text-[13px] text-[var(--nim-text-muted)]">
                Pick one of the organization's projects and point Nimbalyst at a folder for it.
                After that, shared documents, trackers, and sessions for {org.name} open alongside
                your files.
              </p>
              <p className="m-0 mt-3 text-[12px] text-[var(--nim-text-faint)]">
                You can do this later from the organization menu.
              </p>
            </>
          )}

          {step === 'project' && (
            <>
              {loading && (
                <div className="text-[12px] text-[var(--nim-text-muted)]">Loading projects…</div>
              )}
              {loadError && (
                <Alert tone="error" title="Couldn't load the organization's projects" body={loadError} />
              )}
              {!loading && !loadError && projects.length === 0 && (
                <div className="text-[12px] text-[var(--nim-text-muted)]">
                  This organization has no projects yet. An admin can share one from its project settings.
                </div>
              )}
              {projects.length > 0 && (
                <div className="org-project-walk-project-list overflow-hidden rounded-md border border-[var(--nim-border)]">
                  {projects.map((project) => {
                    const chip = statusChip(project.localStatus);
                    const selected = project.teamProjectId === selectedProjectId;
                    return (
                      <button
                        key={project.projectId}
                        type="button"
                        className={`org-project-walk-project-row flex w-full items-center gap-2.5 border-b border-[var(--nim-border)] px-3 py-2.5 text-left last:border-b-0 hover:bg-[var(--nim-bg-hover)] ${selected ? 'bg-[var(--nim-bg-selected)] shadow-[inset_2px_0_0_var(--nim-primary)]' : ''}`}
                        data-testid="org-project-walk-project-row"
                        data-project-id={project.projectId}
                        aria-pressed={selected}
                        onClick={() => setSelectedProjectId(project.teamProjectId)}
                      >
                        {avatar(projectLabel(project), 'sm')}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-[var(--nim-text)]">
                            {projectLabel(project)}
                          </span>
                          {(project.workspacePath || project.remoteUrl) && (
                            <span className="block truncate font-mono text-[11px] text-[var(--nim-text-faint)]">
                              {project.workspacePath ?? project.remoteUrl}
                            </span>
                          )}
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${chip.className}`}>
                          {chip.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {step === 'folder' && (
            <FolderStep
              canClone={canClone}
              cloneUrl={selectedProject?.remoteUrl ?? null}
              mode={mode}
              onModeChange={setMode}
              directoryPath={directoryPath}
              onBrowse={() => void browse()}
              verdict={verdict}
              label={label}
              cloneFailure={cloneFailure}
              actionError={actionError}
            />
          )}

          {step === 'cloning' && (
            <>
              <p className="m-0 text-[13px] text-[var(--nim-text-muted)]">
                Nimbalyst will open the project when this finishes. You can keep working in the meantime.
              </p>
              <div className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-[var(--nim-bg-tertiary)]">
                <div
                  className="h-full rounded-full bg-[var(--nim-primary)] transition-[width]"
                  style={{ width: `${progress?.percent ?? 5}%` }}
                  data-testid="org-project-walk-clone-progress"
                />
              </div>
              <div className="mt-2 font-mono text-[11px] text-[var(--nim-text-faint)]">
                {progress ? `${progress.phase} — ${progress.percent ?? 0}%` : 'Starting…'}
              </div>
            </>
          )}

          {step === 'done' && (
            <p className="m-0 text-[13px] text-[var(--nim-text-muted)]">
              Shared documents, trackers, and team sessions for {org.name} are available in this project.
            </p>
          )}
        </div>

        <footer className="org-project-walk-footer flex items-center gap-2.5 border-t border-[var(--nim-border)] bg-black/10 px-5 py-3">
          {step === 'intro' && (
            <>
              <span className="flex-1" />
              <GhostButton testId="org-project-walk-not-now" onClick={() => dismiss('skip')}>Not now</GhostButton>
              <PrimaryButton testId="org-project-walk-choose-project" onClick={() => setStep('project')}>
                Choose a project
              </PrimaryButton>
            </>
          )}

          {step === 'project' && (
            <>
              <GhostButton testId="org-project-walk-not-now" onClick={() => dismiss('skip')}>Not now</GhostButton>
              <span className="flex-1" />
              <PrimaryButton
                testId="org-project-walk-continue"
                disabled={!selectedProject}
                onClick={() => {
                  // Already on this machine: there is nothing to get, just open it.
                  if (selectedProject?.workspacePath) {
                    void openProject(selectedProject.workspacePath, 'bind');
                    setDirectoryPath(selectedProject.workspacePath);
                    return;
                  }
                  setStep('folder');
                }}
              >
                Continue
              </PrimaryButton>
            </>
          )}

          {step === 'folder' && (
            <>
              <GhostButton testId="org-project-walk-back" onClick={() => setStep('project')}>Back</GhostButton>
              <span className="flex-1" />
              {mode === 'clone' ? (
                <PrimaryButton
                  testId="org-project-walk-clone"
                  disabled={busy || !directoryPath || verdict?.kind !== 'clonable'}
                  onClick={() => void startClone()}
                >
                  Clone and open
                </PrimaryButton>
              ) : (
                <PrimaryButton
                  testId="org-project-walk-open"
                  disabled={busy || !directoryPath || !(verdict?.kind === 'alreadyCloned' || verdict?.kind === 'bindable')}
                  onClick={() => void join('bind')}
                >
                  {busy ? 'Opening…' : 'Open project'}
                </PrimaryButton>
              )}
            </>
          )}

          {step === 'cloning' && (
            <>
              <GhostButton testId="org-project-walk-cancel-clone" onClick={cancelClone}>Cancel</GhostButton>
              <span className="flex-1" />
              <GhostButton testId="org-project-walk-clone-background" onClick={() => dismiss('background')}>
                Continue in background
              </GhostButton>
            </>
          )}

          {step === 'done' && (
            <>
              <span className="flex-1" />
              <PrimaryButton testId="org-project-walk-done" onClick={() => dismiss('done')}>Done</PrimaryButton>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

function FolderStep({
  canClone,
  cloneUrl,
  mode,
  onModeChange,
  directoryPath,
  onBrowse,
  verdict,
  label,
  cloneFailure,
  actionError,
}: {
  canClone: boolean;
  cloneUrl: string | null;
  mode: 'clone' | 'choose';
  onModeChange: (mode: 'clone' | 'choose') => void;
  directoryPath: string | null;
  onBrowse: () => void;
  verdict: ProjectFolderVerdict | null;
  label: string;
  cloneFailure: { kind: CloneFailureKind; detail: string } | null;
  actionError: string | null;
}) {
  const refusal = verdict && directoryPath ? folderRefusalCopy(verdict, directoryPath, label) : null;
  const failure = cloneFailure ? cloneFailureCopy(cloneFailure.kind, cloneUrl ?? label) : null;

  return (
    <>
      {failure && <Alert tone="error" title={failure.title} body={failure.body} />}
      {refusal && <Alert tone={refusal.tone} title={refusal.title} body={refusal.body} />}
      {verdict?.kind === 'alreadyCloned' && directoryPath && (
        <Alert
          tone="success"
          title="You already have this repository"
          body={`${directoryPath} is already a clone of ${label}. Use it instead of cloning again.`}
        />
      )}
      {actionError && <Alert tone="error" title="Couldn't use that folder" body={actionError} />}

      <OptionCard
        icon="download"
        title="Clone the repository"
        description={canClone
          ? 'Nimbalyst clones it for you and opens the project.'
          : "No repository address is recorded for this project. An admin can add one from the organization's project settings."}
        selected={mode === 'clone'}
        unavailable={!canClone}
        testId="org-project-walk-option-clone"
        onSelect={() => onModeChange('clone')}
      >
        {canClone && cloneUrl && (
          <div className="mt-2 truncate rounded border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)] px-2 py-1.5 font-mono text-[11px] text-[var(--nim-text-faint)]">
            {cloneUrl}
          </div>
        )}
      </OptionCard>

      <OptionCard
        icon="folder_open"
        title="Choose an existing folder"
        description={canClone
          ? 'You already have this repository on disk.'
          : 'Point Nimbalyst at the folder for this project.'}
        selected={mode === 'choose'}
        testId="org-project-walk-option-choose"
        onSelect={() => onModeChange('choose')}
      />

      <div className="mt-4">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--nim-text-faint)]">
          {mode === 'clone' ? 'Clone into' : 'Project folder'}
        </div>
        <div className="flex items-stretch overflow-hidden rounded-md border border-[var(--nim-border)] bg-[var(--nim-bg-secondary)]">
          <div
            className={`min-w-0 flex-1 truncate px-2.5 py-2 font-mono text-[12px] ${directoryPath ? 'text-[var(--nim-text)]' : 'text-[var(--nim-text-disabled)]'}`}
            data-testid="org-project-walk-path"
          >
            {directoryPath ?? 'No folder chosen'}
          </div>
          <button
            type="button"
            className="border-l border-[var(--nim-border)] bg-[var(--nim-bg-tertiary)] px-3 text-[12px] text-[var(--nim-text)] hover:bg-[var(--nim-bg-active)]"
            data-testid="org-project-walk-browse"
            onClick={onBrowse}
          >
            Browse…
          </button>
        </div>
      </div>
    </>
  );
}

function OptionCard({
  icon, title, description, selected, unavailable, testId, onSelect, children,
}: {
  icon: string;
  title: string;
  description: string;
  selected: boolean;
  unavailable?: boolean;
  testId: string;
  onSelect: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`org-project-walk-option mb-2.5 flex w-full gap-3 rounded-md border p-3 text-left ${
        unavailable
          ? 'cursor-default border-[var(--nim-border)] opacity-50'
          : selected
            ? 'border-[var(--nim-border-focus)] bg-[var(--nim-bg-selected)]'
            : 'border-[var(--nim-border)] hover:bg-[var(--nim-bg-hover)]'
      }`}
      data-testid={testId}
      aria-pressed={selected}
      disabled={unavailable}
      onClick={onSelect}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--nim-bg-tertiary)] text-[var(--nim-text-muted)]">
        <MaterialSymbol icon={icon} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-[var(--nim-text)]">{title}</span>
        <span className="mt-0.5 block text-[12px] text-[var(--nim-text-muted)]">{description}</span>
        {children}
      </span>
    </button>
  );
}

function Alert({ tone, title, body }: { tone: 'error' | 'warning' | 'success'; title: string; body: string }) {
  const toneClass = tone === 'error'
    ? 'border-[color-mix(in_srgb,var(--nim-error)_45%,transparent)] bg-[color-mix(in_srgb,var(--nim-error)_10%,transparent)] text-[var(--nim-error)]'
    : tone === 'warning'
      ? 'border-[color-mix(in_srgb,var(--nim-warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--nim-warning)_10%,transparent)] text-[var(--nim-warning)]'
      : 'border-[color-mix(in_srgb,var(--nim-success)_45%,transparent)] bg-[color-mix(in_srgb,var(--nim-success)_10%,transparent)] text-[var(--nim-success)]';
  return (
    <div className={`org-project-walk-alert mb-3.5 rounded-md border p-3 ${toneClass}`} data-testid="org-project-walk-alert">
      <div className="text-[12px] font-semibold">{title}</div>
      <div className="mt-0.5 text-[12px] text-[var(--nim-text-muted)]">{body}</div>
    </div>
  );
}

function PrimaryButton({ children, onClick, disabled, testId }: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean; testId: string;
}) {
  return (
    <button
      type="button"
      className="rounded-md bg-[var(--nim-primary)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--nim-bg-secondary)] hover:bg-[var(--nim-primary-hover)] disabled:cursor-default disabled:bg-[var(--nim-bg-tertiary)] disabled:text-[var(--nim-text-disabled)]"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function GhostButton({ children, onClick, testId }: {
  children: React.ReactNode; onClick: () => void; testId: string;
}) {
  return (
    <button
      type="button"
      className="rounded-md px-3.5 py-1.5 text-[13px] text-[var(--nim-text-muted)] hover:bg-[var(--nim-bg-hover)] hover:text-[var(--nim-text)]"
      data-testid={testId}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
