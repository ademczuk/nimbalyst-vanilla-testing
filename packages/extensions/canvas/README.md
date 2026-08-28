# Project Canvas

Authoring guidance for Nimbalyst's Project Canvas boards (`.canvas` files).

**The Canvas editor ships inside Nimbalyst.** Any workspace can already open a `.canvas` file without installing anything. This extension adds the skill an AI session needs to *write* one: the file format, the card reference model, layout conventions, and edges.

## What a board is

An infinite canvas whose cards are live editors mounted on real workspace files and shared documents. A mockup card renders the mockup. A spreadsheet card renders the grid. A markdown card renders the document. Cards are not screenshots -- click into one and you are editing the file.

Use a board when the point is the *arrangement* of real artifacts: screens of a flow, the documents in a workstream, a review board, a project overview. Use Excalidraw for freeform drawing, and MockupLM for a single screen.

## File format

JSON Canvas 1.0 superset. Every spec field keeps its spec meaning, Nimbalyst data lives under `x-nimbalyst`, and unknown keys at any level round-trip verbatim, so a board written by another tool survives being opened here.

```json
{
  "id": "login",
  "type": "file",
  "x": 0, "y": 0, "width": 640, "height": 440,
  "file": "design/mockups/login.mockup.html",
  "x-nimbalyst": {
    "reference": { "kind": "file", "path": "design/mockups/login.mockup.html" },
    "label": "Login"
  }
}
```

What a card *draws as* is decided by `x-nimbalyst.reference`; the spec `type` is chosen so a plain JSON Canvas reader still shows something true. Write both.

Card kinds: `file` (mounts the real editor), `doc` (a shared document), and the native `sticky`, `text`, `image`, and `group` cards.

## Conventions the skill enforces

- Snap geometry to the 20px grid -- the editor snaps on drag, so an off-grid board shifts the first time someone touches it.
- Default reference cards to 640 × 440, with 60-100px of gutter; cards have toolbars, comment badges, and presence chips that collide when they touch.
- Array order is z-order. Put a frame *before* the cards inside it.
- Point file cards at paths that exist. A missing path renders as an unresolved placeholder.

The full guidance lives in `claude-plugin/skills/canvas/SKILL.md`.

## Contents

This extension ships guidance only -- no editor code, no AI tools, no build step. Its `claude-plugin` is enabled by default on install.
