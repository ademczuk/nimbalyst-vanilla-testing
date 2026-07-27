# July 26th 2026 Release

### New Features

- **Claude Opus 5 is the new default.**
- **Voice agents that can see what you're working on.** Voice agents can inspect the current Nimbalyst view, the selected file, and the active session, and capture the app window with your explicit permission.
- **Workstream review in Agent mode.** Agent mode gains a workstream review panel and per-session chat panels, and the Agent popover previews live sessions before you switch to them.
- **An AI session pane for pull request review.** Pull request review mode gains a resizable AI session pane that carries the selected pull request into the conversation, with its linked sessions shown in the header.
- **Title bar controls in project windows.** Project windows now carry title bar controls for Git, session, and panel actions.

### Fixed

**AI sessions and agents**

- Sessions no longer stay stuck showing "awaiting input" once the AI has stopped waiting.
- Claude Agent and Claude Code CLI pickers offer Opus 5 (1M) and Fable 5 (1M) again, and the CLI context meter reports the window the session is really running at (#989, diagnosed by @Derazien).
- Claude Code and Codex now honor relocated config directories, so usage, session history, settings, plugins, commands, and skills all resolve correctly.
- Remote MCP server sign-in recognizes successful authorization instead of reporting it as rejected, and gives slower sign-ins more time to complete.
- Automations no longer rerun the same scheduled occurrence after a restart while a run is waiting or failing.
- Voice Mode explains blocked or missing microphones on Windows and links directly to microphone privacy settings.
- Clearing the last queued prompt syncs to your other devices instead of leaving a stale queued count (#817).
- Long or multi-line prompts sent to a Claude Code CLI session are no longer truncated or split across several pasted-text placeholders.

**Editors and UI**

- File links in a transcript open the right file when the extension is longer than eight characters, such as `.excalidraw`.
- Long git errors no longer stretch the title bar's Git menu across the window, a rejected push now says to pull first, and Git actions are hidden in projects that are not git repositories.
- Pinning or unpinning a session inside an expanded workstream updates its icon, menu, and position immediately (#972).
- Session-pane title reveals appear only for clipped names and expand from the truncated text, and session, workstream, and worktree labels reveal their complete names in wrapped hover tooltips.
- The worktree name shown above the Commit panel no longer changes to the session title once the agent names the session.
