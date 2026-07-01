# July 1 Release

This release brings a new, optional project memory system, a major trackers upgrade, expanded voice mode (still alpha), plus the latest Claude models and a long list of fixes.

### New Features

**Project memory & search**
- New Nimbalyst Memory extension: indexes your project notes and surfaces relevant facts to the AI and voice agent for grounded answers.
- Global semantic search in Quick Open (Cmd+Shift+O): find any tracker or document by meaning, with an option to include past AI sessions.
- Memory recall now shows a transcript card with the query and matched source documents, click-to-open.

**Trackers**
- Reference a tracker item from any document or AI chat: type `#` to pick an item and insert a live chip showing its current status and title. The AI links tracker items as clickable chips too.
- Link tracker items to one another with relationship fields, including automatic "Linked from" backlinks.
- New tracker views: a tag board, saved views (filter and group), and kanban columns that follow each type's custom status order.
- Customize or reset a tracker type's schema from Settings, with a drift warning when it diverges.
- Edit and delete your own tracker comments.
- Share individual plans (and other full-document trackers) with your team — the shared copy keeps its status, lifecycle, and body in sync, including changes made offline.
- Control whether AI agents can use your trackers per project with an "AI Agent Access" toggle.
- Optional "Shared" column in the tracker table shows which items are shared with the team.
- New `nim` companion CLI for trackers: list, create, update, comment on, archive, and import items from the terminal.

**Voice mode**
- Start a new coding session by voice — say "create a new session" on desktop or mobile.
- On mobile, find sessions by topic, switch sessions, summarize a session, answer a session's pending question by voice, and send coding tasks to your desktop.
- The mobile floating mic shows what the voice agent is doing, with clear Pause and Cancel buttons.
- Choose the voice model and reasoning level in Voice Mode settings.

**Models & platforms**
- Claude Sonnet 5 and Claude Fable 5 are now selectable across the Claude chat, Agent, and Code CLI providers.
- New Android app with email/magic-link sign-in, push notifications, deep links, and a pairing QR scanner.
- New Gemini (Antigravity) extension, usable as an AI chat and meta-agent provider.
- New RTL Support extension: auto-detects right-to-left languages and renders the transcript and input correctly.

**Other**
- Custom completion sounds — pick your own audio file to play when an agent finishes a turn.
- `/session-cleanup` command tidies your Sessions board with phase corrections and archive suggestions.
- Dart syntax highlighting in the Monaco editor.

### Improvements

- Claude Code CLI sessions store and sync far less redundant data, and defer MCP tool schema loading to cut baseline context usage.
- New AI sessions appear immediately instead of waiting for sync to connect.
- Contextual tips now fill empty AI sessions immediately.
- Updating a tracker item no longer links it to the current AI session unless you ask.
- Linked sessions now appear at the top of a tracker item's detail.

### Fixed

**Trackers**
- Linking tracker items now reliably updates both sides and no longer goes stale or drops other links after syncing, including when the AI sets the link.
- Tracker relationship fields no longer get cleared or dropped by concurrent syncs.
- Tracker status changes now work for custom types that rename their workflow status field.
- Tracker reference links (`nimbalyst://` chips) in chat no longer render blank.
- Reopened secondary projects now scope the tracker list to the correct project.
- Tracker type counts no longer briefly flash "0" while data is still loading.
- Fixed tracker field corruption on the SQLite backend caused by merging JSON updates.

**AI & sessions**
- Claude Code background sub-agents are no longer killed when the lead agent's turn ends.
- AI session status no longer stays stuck on "running" in the mobile app after a turn finishes on desktop.
- Another session can read an OpenAI Codex session's last reply through the session-summary tools.
- Windows: Claude Code CLI chat sessions now start reliably, including with multi-line system prompts.
- Extension AI tools (such as OpenSCAD and Replicad) no longer revert recent file edits by saving stale content over them.

**Voice**
- Voice mode always speaks in your configured preferred language, including on mobile.
- The iOS voice agent reliably speaks its response after a coding agent finishes a task.
- Voice replies no longer speed up, skip, garble, or overlap near the end of longer responses.

**Other**
- Toggling an extension on/off via an AI agent now actually restarts its backend, and importer crash errors include the real failure reason.
- Git worktrees with branch-style names and a project's own subfolders inherit the parent project's agent permissions instead of re-prompting.
- On Windows, clicking a file link in chat opens the file instead of a blank window.
- Stop prompting to run the Gemini backend at startup; it now starts only when you use Gemini.
- Committing no longer triggers a burst of slow database queries that briefly hitched the app.
- Desktop release builds now bundle the application correctly.
