// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activate, aiTools } from '../index';
import { parseAutomationStatus } from '../frontmatter/parser';

function automationFile(): string {
  return `---
automationStatus:
  id: codex-scout
  title: Codex Scout
  enabled: true
  schedule:
    type: daily
    time: "09:00"
  output:
    mode: new-file
    location: nimbalyst-local/automations/codex-scout/
    fileNameTemplate: "{{date}}-output.md"
  provider: openai-codex
  model: openai-codex:gpt-5.6-sol
  runCount: 0
---

Run the scout.
`;
}

function makeHarness(initial: Array<[string, string]> = []) {
  const files = new Map(initial);
  return {
    files,
    ui: { showInfo: vi.fn(), showWarning: vi.fn(), showError: vi.fn() },
    filesystem: {
      readFile: async (filePath: string) => {
        const content = files.get(filePath);
        if (content === undefined) throw new Error(`ENOENT: ${filePath}`);
        return content;
      },
      writeFile: async (filePath: string, content: string) => {
        files.set(filePath, content);
      },
      fileExists: async (filePath: string) => files.has(filePath),
      findFiles: async () => [...files.keys()].filter((p) => p.startsWith('nimbalyst-local/automations/') && p.endsWith('.md')),
    },
  };
}

describe('automation execution', () => {
  const disposables: Array<{ dispose: () => void }> = [];

  afterEach(() => {
    for (const disposable of disposables.splice(0)) disposable.dispose();
    vi.restoreAllMocks();
  });

  it('writes append output to the configured file name instead of always output.md', async () => {
    // #1351: fileNameTemplate was read only in new-file mode, so an append
    // automation silently logged to output.md whatever its frontmatter said.
    const path = 'nimbalyst-local/automations/poller.md';
    const harness = makeHarness([[path, `---
automationStatus:
  id: poller
  title: Poller
  enabled: true
  schedule:
    type: daily
    time: "09:00"
  output:
    mode: append
    location: nimbalyst-local/automations/poller/
    fileNameTemplate: "{{id}}-log.md"
  runCount: 0
---

Poll.
`]]);
    const sendPrompt = vi.fn().mockResolvedValue({ sessionId: 's1', response: 'all quiet' });

    await activate({ services: { filesystem: harness.filesystem, ui: harness.ui, ai: { sendPrompt } }, subscriptions: disposables });
    await aiTools.find((t) => t.name === 'automations.run')!.handler({ id: 'poller' }, {} as never);

    expect(harness.files.get('nimbalyst-local/automations/poller/poller-log.md')).toContain('all quiet');
    expect(harness.files.has('nimbalyst-local/automations/poller/output.md')).toBe(false);
  });

  it('creates a disabled automation by default and says so, without inventing a file name template', async () => {
    const harness = makeHarness();
    await activate({ services: { filesystem: harness.filesystem, ui: harness.ui }, subscriptions: disposables });
    const createTool = aiTools.find((t) => t.name === 'automations.create')!;
    const context = { extensionContext: { services: { filesystem: harness.filesystem } } } as never;

    const result = await createTool.handler(
      { id: 'quiet', title: 'Quiet: poller', prompt: 'Check.', schedule_type: 'interval', interval_minutes: 5, output_mode: 'append' },
      context,
    );

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect((result as { message: string }).message).toContain('DISABLED');

    // A colon in the title must not break the YAML the automation parses from.
    const status = parseAutomationStatus(harness.files.get('nimbalyst-local/automations/quiet.md')!);
    expect(status).toEqual(expect.objectContaining({ title: 'Quiet: poller', enabled: false }));
    expect(status?.output.fileNameTemplate).toBeUndefined();
  });

  it('creates an enabled automation with the requested output location and file name', async () => {
    const harness = makeHarness();
    await activate({ services: { filesystem: harness.filesystem, ui: harness.ui }, subscriptions: disposables });
    const createTool = aiTools.find((t) => t.name === 'automations.create')!;
    const context = { extensionContext: { services: { filesystem: harness.filesystem } } } as never;

    const result = await createTool.handler(
      {
        id: 'digest',
        title: 'Digest',
        prompt: 'Summarize.',
        output_location: 'reports/digest',
        output_file_name: 'latest.md',
        output_mode: 'replace',
        enabled: true,
      },
      context,
    );

    expect((result as { message: string }).message).toContain('enabled');
    const status = parseAutomationStatus(harness.files.get('nimbalyst-local/automations/digest.md')!);
    expect(status).toEqual(expect.objectContaining({ enabled: true }));
    expect(status?.output).toEqual(expect.objectContaining({
      location: 'reports/digest/',
      fileNameTemplate: 'latest.md',
    }));
  });

  it('records a Codex prompt rejection as an error while preserving the failure output', async () => {
    const path = 'nimbalyst-local/automations/codex-scout.md';
    const files = new Map([[path, automationFile()]]);
    const sendPrompt = vi.fn().mockRejectedValue(
      new Error('API key not configured for provider openai-codex.'),
    );
    const ui = { showInfo: vi.fn(), showWarning: vi.fn(), showError: vi.fn() };
    const filesystem = {
      readFile: async (filePath: string) => {
        const content = files.get(filePath);
        if (content === undefined) throw new Error(`ENOENT: ${filePath}`);
        return content;
      },
      writeFile: async (filePath: string, content: string) => {
        files.set(filePath, content);
      },
      fileExists: async (filePath: string) => files.has(filePath),
      findFiles: async () => [path],
    };

    await activate({ services: { filesystem, ui, ai: { sendPrompt } }, subscriptions: disposables });

    const runTool = aiTools.find((tool) => tool.name === 'automations.run');
    expect(runTool).toBeDefined();
    const result = await runTool!.handler({ id: 'codex-scout' }, {} as never);

    expect(sendPrompt).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openai-codex',
      model: 'openai-codex:gpt-5.6-sol',
    }));
    expect(result).toEqual({
      success: false,
      error: 'API key not configured for provider openai-codex.',
    });

    const status = parseAutomationStatus(files.get(path)!);
    expect(status).toEqual(expect.objectContaining({
      lastRunStatus: 'error',
      lastRunError: 'API key not configured for provider openai-codex.',
      runCount: 0,
    }));

    const history = JSON.parse(files.get('nimbalyst-local/automations/codex-scout/history.json')!);
    expect(history).toEqual([
      expect.objectContaining({
        status: 'error',
        error: 'API key not configured for provider openai-codex.',
      }),
    ]);

    const output = [...files.entries()].find(([filePath]) => filePath.endsWith('-output.md'))?.[1];
    expect(output).toContain('API key not configured for provider openai-codex.');
    expect(ui.showError).toHaveBeenCalledWith(
      'Automation "Codex Scout" failed: API key not configured for provider openai-codex.',
    );
  });
});
