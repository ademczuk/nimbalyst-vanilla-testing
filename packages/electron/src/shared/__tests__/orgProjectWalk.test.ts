// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  classifyCloneFailure,
  classifyProjectFolder,
  isSafeCloneUrl,
  parseCloneProgress,
  redactRemoteAddresses,
  resolveAccountOrgRow,
  resolveProjectWalkPresentation,
  shouldRemoveFailedCloneDestination,
  type FailedCloneDestinationEvidence,
} from '../orgProjectWalk';

const ACME = { orgId: 'org-acme', name: 'Acme Corp' };
const OTHER = { orgId: 'org-other', name: 'Other Corp' };

describe('resolveProjectWalkPresentation', () => {
  it('offers the walk to a member whose open workspaces resolve to no org', () => {
    expect(resolveProjectWalkPresentation({ orgs: [ACME], boundOrgIds: [] }))
      .toEqual({ enterableOrgs: [ACME], autoPresentOrg: ACME });
  });

  it('stops interrupting once any open workspace already resolves to one of the orgs', () => {
    expect(resolveProjectWalkPresentation({ orgs: [ACME, OTHER], boundOrgIds: ['org-other'] }))
      .toMatchObject({ autoPresentOrg: null });
  });

  // The bug behind "I can't figure out how to get into my project or org and
  // work!": another window being bound erased the entry point in THIS window,
  // whose own folder matched nothing, leaving only "No organization — Set up".
  it('still lets this window enter an org that only another window is bound to', () => {
    expect(resolveProjectWalkPresentation({
      orgs: [ACME, OTHER],
      boundOrgIds: ['org-other'],
      thisWindowOrgId: null,
    }).enterableOrgs).toEqual([ACME, OTHER]);
  });

  it('drops only the org this window is already in', () => {
    expect(resolveProjectWalkPresentation({
      orgs: [ACME, OTHER],
      boundOrgIds: ['org-acme'],
      thisWindowOrgId: 'org-acme',
    }).enterableOrgs).toEqual([OTHER]);
  });

  // `orgs[0]` made every membership past the first unreachable by construction.
  it('keeps every membership, not just the first', () => {
    const THIRD = { orgId: 'org-third', name: 'Third Corp' };
    expect(resolveProjectWalkPresentation({ orgs: [ACME, OTHER, THIRD], boundOrgIds: [] })
      .enterableOrgs).toEqual([ACME, OTHER, THIRD]);
  });

  it('stays quiet for an account with no organizations at all', () => {
    expect(resolveProjectWalkPresentation({ orgs: [], boundOrgIds: [] }))
      .toEqual({ enterableOrgs: [], autoPresentOrg: null });
  });

  // Dismissal silences the dialog, never the way in. The entry point reads
  // `enterableOrgs`, so it must survive a dismissal that clears the interrupt.
  it('keeps the org enterable after a dismissal but stops presenting it unprompted', () => {
    expect(resolveProjectWalkPresentation({
      orgs: [ACME],
      boundOrgIds: [],
      dismissedOrgIds: ['org-acme'],
    })).toEqual({ enterableOrgs: [ACME], autoPresentOrg: null });
  });

  it('ignores a dismissal recorded for a different organization', () => {
    expect(resolveProjectWalkPresentation({
      orgs: [ACME],
      boundOrgIds: [],
      dismissedOrgIds: ['org-other'],
    }).autoPresentOrg).toEqual(ACME);
  });
});

describe('resolveAccountOrgRow', () => {
  it('offers to join the project instead of setting up an org the user already has', () => {
    expect(resolveAccountOrgRow({
      projectOrg: null,
      projectOrgLoading: false,
      enterableOrgs: [ACME],
    })).toEqual({ kind: 'joinProject', org: ACME });
  });

  it('still offers setup to an account with no organizations', () => {
    expect(resolveAccountOrgRow({ projectOrg: null, projectOrgLoading: false, enterableOrgs: [] }))
      .toEqual({ kind: 'setUp' });
  });

  it('shows the resolved organization once the workspace matches one', () => {
    expect(resolveAccountOrgRow({ projectOrg: ACME, projectOrgLoading: false, enterableOrgs: [] }))
      .toEqual({ kind: 'organization', org: ACME });
  });

  it('reports an unfinished lookup rather than guessing at it', () => {
    expect(resolveAccountOrgRow({ projectOrg: null, projectOrgLoading: true, enterableOrgs: [ACME] }))
      .toEqual({ kind: 'loading' });
  });
});

describe('classifyProjectFolder', () => {
  const REPO_HASH = 'hash-platform';
  const missing = { exists: false, isDirectory: false, isEmpty: true, folderRemoteHash: null };

  it('allows a clone into a folder that does not exist yet', () => {
    expect(classifyProjectFolder(missing, REPO_HASH)).toEqual({ kind: 'clonable' });
  });

  it('allows a clone into an existing empty folder', () => {
    expect(classifyProjectFolder(
      { exists: true, isDirectory: true, isEmpty: true, folderRemoteHash: null },
      REPO_HASH,
    )).toEqual({ kind: 'clonable' });
  });

  // The happy accident the mockup calls out: bind it, do not clone it twice.
  it('recognizes a folder that is already a clone of the project', () => {
    expect(classifyProjectFolder(
      { exists: true, isDirectory: true, isEmpty: false, folderRemoteHash: REPO_HASH },
      REPO_HASH,
    )).toEqual({ kind: 'alreadyCloned' });
  });

  it('refuses a folder whose remote points at something else', () => {
    expect(classifyProjectFolder(
      { exists: true, isDirectory: true, isEmpty: false, folderRemoteHash: 'hash-notes' },
      REPO_HASH,
    )).toEqual({ kind: 'wrongRemote' });
  });

  it('refuses a non-empty unrelated folder rather than cloning into it', () => {
    expect(classifyProjectFolder(
      { exists: true, isDirectory: true, isEmpty: false, folderRemoteHash: null },
      REPO_HASH,
    )).toEqual({ kind: 'occupied' });
  });

  it('refuses a path that is a file', () => {
    expect(classifyProjectFolder(
      { exists: true, isDirectory: false, isEmpty: false, folderRemoteHash: null },
      REPO_HASH,
    )).toEqual({ kind: 'notADirectory' });
  });

  // A project with no recorded remote is matched by a local binding instead, so
  // any folder will do -- including one that already has files in it.
  it('lets a remote-less project bind a folder that already has files', () => {
    expect(classifyProjectFolder(
      { exists: true, isDirectory: true, isEmpty: false, folderRemoteHash: null },
      null,
    )).toEqual({ kind: 'bindable' });
  });
});

describe('isSafeCloneUrl', () => {
  it.each([
    'https://github.com/acme/platform.git',
    'git@github.com:acme/platform.git',
    'ssh://git@github.com/acme/platform.git',
  ])('accepts %s', (url) => {
    expect(isSafeCloneUrl(url)).toBe(true);
  });

  // The URL arrives from the server and is handed to `git` as argv. Anything
  // that could be read as an option (`--upload-pack=...`) is a command the org
  // admin would be executing on every member's machine.
  it.each([
    '--upload-pack=/bin/sh',
    '-u/bin/sh',
    'ext::sh -c whoami',
    'not a url',
    '',
  ])('rejects %s', (url) => {
    expect(isSafeCloneUrl(url)).toBe(false);
  });
});

describe('classifyCloneFailure', () => {
  it('reads a credential prompt failure as an auth problem', () => {
    expect(classifyCloneFailure('fatal: Authentication failed for https://github.com/acme/platform'))
      .toBe('auth');
  });

  it('reads a rejected public key as an auth problem', () => {
    expect(classifyCloneFailure('git@github.com: Permission denied (publickey).')).toBe('auth');
  });

  // A private repo answers "not found" to an unauthenticated client, so this
  // must not be reported as "the admin gave you a bad address".
  it('reads a missing repository as an auth problem too', () => {
    expect(classifyCloneFailure("fatal: repository 'https://github.com/acme/platform/' not found"))
      .toBe('auth');
  });

  it('separates a network failure from a credential one', () => {
    expect(classifyCloneFailure('fatal: unable to access ...: Could not resolve host: github.com'))
      .toBe('network');
  });

  it('falls back to unknown rather than blaming credentials', () => {
    expect(classifyCloneFailure('fatal: destination path already exists')).toBe('unknown');
  });
});

describe('parseCloneProgress', () => {
  it('reads the phase and percentage out of git --progress output', () => {
    expect(parseCloneProgress('Receiving objects:  46% (2300/5000), 18.20 MiB | 5.00 MiB/s\r'))
      .toEqual({ phase: 'Receiving objects', percent: 46 });
  });

  it('keeps the last progress line in a multi-line chunk', () => {
    expect(parseCloneProgress('Receiving objects:  12% (1/8)\rResolving deltas:  80% (7/8)\r'))
      .toEqual({ phase: 'Resolving deltas', percent: 80 });
  });

  it('ignores output with no progress in it', () => {
    expect(parseCloneProgress("Cloning into 'platform'...")).toBeNull();
  });
});

// A wrong answer here deletes a user's folder recursively, so each case is a
// distinct reason the destination might not be the clone's to remove.
describe('shouldRemoveFailedCloneDestination', () => {
  const evidence = (
    overrides: Partial<FailedCloneDestinationEvidence>,
  ): FailedCloneDestinationEvidence => ({
    absentBeforeClone: true,
    gitRefusedExistingDestination: false,
    isDirectoryNow: true,
    entriesNow: ['.git'],
    ...overrides,
  });

  it('removes the half-repository a failed clone left behind', () => {
    expect(shouldRemoveFailedCloneDestination(evidence({
      entriesNow: ['.git', 'README.md', 'src'],
    }))).toBe(true);
  });

  it('removes the empty directory the clone created and never filled', () => {
    expect(shouldRemoveFailedCloneDestination(evidence({ entriesNow: [] }))).toBe(true);
  });

  it('leaves a directory that already existed before the clone started', () => {
    expect(shouldRemoveFailedCloneDestination(evidence({ absentBeforeClone: false }))).toBe(false);
  });

  // The time-of-check/time-of-use case: absent at the pre-flight check, then
  // created and filled by something else before git looked at it. git refusing
  // the path is proof it wrote nothing there.
  it('leaves contents git refused to touch, however the pre-flight check read', () => {
    expect(shouldRemoveFailedCloneDestination(evidence({
      gitRefusedExistingDestination: true,
      entriesNow: ['taxes.pdf', 'photos'],
    }))).toBe(false);
  });

  it('leaves a non-empty directory with no sign git created it', () => {
    expect(shouldRemoveFailedCloneDestination(evidence({
      entriesNow: ['taxes.pdf', 'photos'],
    }))).toBe(false);
  });

  it('does nothing when the destination is gone or is not a directory', () => {
    expect(shouldRemoveFailedCloneDestination(evidence({
      isDirectoryNow: false,
      entriesNow: null,
    }))).toBe(false);
    expect(shouldRemoveFailedCloneDestination(evidence({ entriesNow: null }))).toBe(false);
  });
});

describe('redactRemoteAddresses', () => {
  it('strips the repository address out of git failure text', () => {
    expect(redactRemoteAddresses("fatal: repository 'https://git.example.com/acme/secret-platform/' not found"))
      .toBe("fatal: repository '[redacted]' not found");
  });

  it('strips scp-style addresses and the emails they carry', () => {
    expect(redactRemoteAddresses('fatal: could not read from git@git.example.com:acme/secret.git'))
      .toBe('fatal: could not read from [redacted]');
  });

  it('keeps text that names no address', () => {
    expect(redactRemoteAddresses('fatal: Authentication failed'))
      .toBe('fatal: Authentication failed');
  });
});
