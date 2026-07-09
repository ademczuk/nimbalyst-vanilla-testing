# July 8th 2026 Release

Cumulative release notes since v0.66.9.

### New Features

- **Customize the navigation gutter.** Right-click the gutter to hide, show, or drag-reorder any icon, with your preferences applied across all projects.
- **Pull Requests connect to trackers and sessions.** Review-status badges and filter chips, one-click jumps between a PR, its tracker item, and its review session, link any tracker item to a PR, and merges update linked tracker items automatically.
- **Tools & Token Cost settings panel.** See every tool group's estimated context-token cost and load policy in one place, linked from the AI panel's token meter.
- **Unread indicators** highlight trackers that have changed since you last viewed them.
- **Maximize the editor.** Double-click an editor tab to expand the editor area in Files and Agent modes, and double-click again to restore.
- **Chat input pills.** Slash commands, `@` file references, and `@@` session mentions now appear as tinted pills anywhere in a message; slash-command pills stay clickable to show what each command does and open its source.
- **Custom Claude Code API proxy.** An advanced setting can route Claude Code CLI (Subscription) traffic through a custom local API endpoint, such as a token-compression or caching layer.
- **New built-in extensions:** Browser, Calc Sheets, GitHub Issues Importer, and Memory, plus refreshed versions of the existing ones.

### Improvements

- **Trim the session model picker.** Each provider's settings page has checkboxes to hide models you don't use, and the Claude Agent SDK and Claude Code CLI sets can be enabled independently.
- **Slightly reduce per-request token usage.** Agent sessions omit tracker guidance when trackers are off and defer more MCP tool definitions.
- **Voice mode** replies more briefly and no longer asks you to approve tasks that auto-send after the on-screen countdown.

### Fixed

- Windows: Claude Code no longer breaks after an app update, and a broken install now shows an honest "repair Nimbalyst" message instead of a misleading libc error.
- Scheduled interval automations now fire on time, and one whose due time passed while the app was closed runs once on next open.
- Background agents launched by a session are no longer killed when the session's turn ends.
- Claude Agent sessions recover a turn whose stream closes mid-response instead of losing the reply, and Claude Code sessions end with an error instead of spinning forever on a stalled stream.
- Corrected issue where some models may be missing from model picker.
- Meta agents and their sub-agents group together on mobile in real time, and iOS session badges correctly label Fable 5 and Sonnet 5 sessions.
- Open custom-editor tabs (Replicad, Excalidraw, and more) refresh when an agent edits the file instead of staying stale.
- Tracker item content no longer renders as raw JSON after closing and reopening, plan items show fresh timestamps, and spurious timestamp churn is stopped.
- Git branch watching no longer crawls the entire workspace, cutting CPU and disk churn in large projects.
- Fewer lost project states on reopen.
- Marketplace extension installs no longer hang mid-extraction.
- Settings navigation reaches the Marketplace in project scope and Privileged Capabilities in all scopes.
- Interactive input prompts stay interactive even if you take more than five minutes to respond.
- Mockup share links render full-size in the browser.
- Clicking a relative file link in a markdown doc opens the file in a tab instead of a blank window.
- Mobile document sync propagates `.md` deletions across devices and reconnects after you change sync settings.
- The mobile project list no longer drops or wipes projects when the sync snapshot briefly shrinks.
