import React from 'react';
import { ProviderConfig } from '../../Settings/SettingsView';
import { HeadlessCliProviderPanel } from './HeadlessCliProviderPanel';

interface CursorAgentPanelProps {
  config: ProviderConfig;
  onToggle: (enabled: boolean) => void;
}

export function CursorAgentPanel({ config, onToggle }: CursorAgentPanelProps) {
  return (
    <HeadlessCliProviderPanel
      config={config}
      onToggle={onToggle}
      toolId="cursor-agent"
      title="Cursor Agent"
      description="The Cursor coding agent, run headlessly against your project. Uses your existing Cursor CLI login."
      commandName="Cursor"
      loginCommand="cursor-agent login"
      docsUrl="https://cursor.com/docs/cli/using"
      docsLabel="Cursor CLI documentation"
      // Reports path, unified diff, and the file's pre-edit contents on every
      // edit, plus a typed delete carrying the removed file's contents.
      fileChangeFidelity="structured"
    />
  );
}
