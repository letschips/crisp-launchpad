# Crisp Launchpad

Native Obsidian launchpad prototype for ANKS.

This plugin replaces the DataviewJS launchpad as the long-term interface
direction while keeping the existing `00-启动台.md` as a fallback during
acceptance testing.

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
- Content pipeline, inbox, recent outputs, knowledge activity, and navigation.
- Explicit snapshot refresh through `Sidecar/bin/anks`.
- No network dependency.

## Requirements

- Obsidian 1.6.0 or later.
- ANKS vault with `Sidecar/bin/anks`.
- macOS / POSIX for one-click snapshot refresh.

## Development

```bash
npm run check
```

Install into a vault by copying `main.js`, `manifest.json`, and `styles.css`
into `.obsidian/plugins/crisp-launchpad/`.

## Status

`0.1.0` is a local prototype. It is not a public Crisp Suite release.
