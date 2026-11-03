# Crisp Launchpad

Native Obsidian launchpad for ANKS.

This plugin replaces the DataviewJS launchpad. The former `00-启动台.md` is
retired and archived under `.personal-os-backups/`; the native views are the
only interfaces.

## Features

- Native `ItemView` instead of a DataviewJS note.
- System status from `.runtime/snapshot/health.json` and `index.json`.
- Today / waiting / upcoming actions from Crisp Tempo (the only action source; see `docs/ROLE-CONTRACT.md`).
- Selectable 4 / 13 / 26 / 52 week rhythm ranges.
- The heatmap always keeps the full 53-week context; range selection only changes the active statistics interval.
- Quick capture (hands off to Crisp Pulse when enabled); new actions open Crisp Tempo's quick add.
- One-click inbox conversion to action or topic card.
- First-run onboarding and local environment repair.
- Native creation and stage progression for ANKS content projects.
- Direct linkage to the prepared Crisp Base content overview.
- Opt-in event bridge for safe routing and snapshot synchronization.
- Unified review tab that generates the next deduplicated batch of actions into Crisp Tempo.
- Mobile-compatible capture, content project editing, and responsive layouts.
- Content pipeline, inbox, recent outputs, knowledge activity, and navigation.
- Explicit snapshot refresh through `Sidecar/bin/anks`.
- No network dependency.

## Requirements

- Obsidian 1.6.0 or later.
- ANKS vault with `Sidecar/bin/anks`.
- Crisp Tempo (enabled and activated) for actions; without it the action board shows a hint.
- macOS / POSIX for one-click snapshot refresh and the automatic event bridge.
- Mobile supports Markdown-native capture and content edits; CLI-backed refresh stays desktop-only.

## Development

```bash
npm run check
```

Install into a vault by copying `main.js`, `manifest.json`, and `styles.css`
into `.obsidian/plugins/crisp-launchpad/`.

## Status

Released on GitHub. The Crisp Suite / ANKS starter package ships the current version; later updates come from GitHub Releases (`main.js`, `manifest.json`, `styles.css`).
