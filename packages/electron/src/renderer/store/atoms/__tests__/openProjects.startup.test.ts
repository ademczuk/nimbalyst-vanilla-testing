// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { store } from '@nimbalyst/runtime/store';
import { activeWorkspacePathAtom, initOpenProjects, openProjectsAtom, teardownOpenProjects } from '../openProjects';

afterEach(() => { teardownOpenProjects(); vi.unstubAllGlobals(); });

it('registers all restored projects and activates the saved project in main without a rail click', async () => {
  const paths = Array.from({ length: 32 }, (_,i) => `/project-${i + 1}`);
  const invoke = vi.fn(async (channel: string) => {
    switch (channel) {
      case 'app:get-multi-project-mode':
      case 'app:get-restore-previous-projects': return true;
      case 'app:get-open-projects': return paths;
      case 'app:get-active-project-path': return paths[31];
      default: return { success: true };
    }
  });
  vi.stubGlobal('window', { electronAPI: {
    invoke,
    getInitialState: async () => ({ mode: 'workspace', workspacePath: paths[0], activeWorkspacePath: paths[0], openProjectPaths: [paths[0]] }),
  } });
  await initOpenProjects();
  expect(store.get(openProjectsAtom).map(p => p.path)).toEqual(paths);
  expect(store.get(activeWorkspacePathAtom)).toBe(paths[31]);
  expect(invoke.mock.calls.filter(([channel]) => channel === 'workspace:register-additional')).toHaveLength(31);
  expect(invoke).toHaveBeenCalledWith('workspace:set-active', { workspacePath: paths[31] });
});
