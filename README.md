# Crisp Launchpad

Native Obsidian launchpad for ANKS.

This plugin replaces the DataviewJS launchpad. The former `00-启动台.md` is
retired and archived under `.personal-os-backups/`; the native views are the
only interfaces.

## Features

- Native `ItemView` instead of a DataviewJS note.
- System status from `.runtime/snapshot/health.json` and `index.json`.
- Today / waiting / upcoming actions from `.runtime/snapshot/actions.json`.
- Selectable 4 / 13 / 26 / 52 week rhythm ranges.
- The heatmap always keeps the full 53-week context; range selection only changes the active statistics interval.
- Native quick capture and new-action entry.
- One-click inbox conversion to action or topic card.
- First-run onboarding and local environment repair.
- Native Crisp Now action board backed by `Now/行动.md`.
- Native creation and stage progression for ANKS content projects.
- Direct linkage to the prepared Crisp Base content overview.
- Opt-in event bridge for safe routing and snapshot synchronization.
- Unified review tab that generates the next deduplicated batch of Now actions.
- Mobile-compatible capture, Now board (tap-to-reschedule presets for touch, cross-column drag for desktop), content project editing, and responsive layouts.
- Content pipeline, inbox, recent outputs, knowledge activity, and navigation.
- Explicit snapshot refresh through `Sidecar/bin/anks`.
- No network dependency.

## Requirements

- Obsidian 1.6.0 or later.
- ANKS vault with `Sidecar/bin/anks`.
- macOS / POSIX for one-click snapshot refresh and the automatic event bridge.
- Mobile supports Markdown-native capture and Now/content edits (with quick preset rescheduling on touch devices); CLI-backed refresh stays desktop-only.

## Development

```bash
npm run check
```

Install into a vault by copying `main.js`, `manifest.json`, and `styles.css`
into `.obsidian/plugins/crisp-launchpad/`.

## Status

`0.2.13` is the latest Crisp Suite release.
