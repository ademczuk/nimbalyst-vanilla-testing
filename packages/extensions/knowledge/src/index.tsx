import { KnowledgeCuratorSettings } from './components/CuratorSettings';

export function activate(): void {}

export function deactivate(): void {}

/** Settings route component, referenced by manifest contributions.settingsRoutes. */
export const settingsPanel = {
  KnowledgeCuratorSettings,
};
