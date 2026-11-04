# Crisp Launchpad

Native Obsidian launchpad for ANKS.

This plugin replaces the DataviewJS launchpad. The former `00-启动台.md` is
retired and archived under `.personal-os-backups/`; the native views are the
only interfaces.

## Features

- Native `ItemView` instead of a DataviewJS note.
- System status from `.runtime/snapshot/health.json` and `index.json`.
- Today strip: actions, Tempo completions, Crisp Pulse score / streak / pending memos, and inbox total; each item appears only when its source is available.
- Today / waiting / upcoming actions from Crisp Tempo (the only action source; see `docs/ROLE-CONTRACT.md`), filtered with a segmented control.
- Two-layer cards and segmented tabs shared with Crisp Pulse.
- Selectable 4 / 13 / 26 / 52 week rhythm ranges.
- The heatmap always keeps the full 53-week context; range selection only changes the active statistics interval.
- Quick capture (hands off to Crisp Pulse when enabled); new actions open Crisp Tempo's quick add.
- One-click inbox conversion to action or topic card.
- First-run onboarding and local environment repair.
- Native creation and stage progression for ANKS content projects.
- Direct linkage to the prepared Crisp Base content overview.
- Opt-in event bridge for safe routing and snapshot synchronization.
- Review preview checks the last 14 days of Tempo completions; only confirmed selections become tasks, with links to their sources.
- Full system findings and inbox totals, with expandable stage and inbox lists.
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

Browser workflow checks run against the real plugin in Chromium with an in-memory vault and Tempo boundary fixture (no user data writes). Install `playwright-core` in your development environment, then run `npm run test:e2e`. Optional environment variables: `LAUNCHPAD_PLAYWRIGHT` (module path), `LAUNCHPAD_CHROME` (browser executable), and `LAUNCHPAD_E2E_OUTPUT` (JSON/screenshot output directory; default `/tmp/crisp-launchpad-e2e`). Real Obsidian, Windows and phone keyboard behavior require separate host checks.

Install into a vault by copying `main.js`, `manifest.json`, and `styles.css`
into `.obsidian/plugins/crisp-launchpad/`.

## Status

Released on GitHub. The Crisp Suite / ANKS starter package ships the current version; later updates come from GitHub Releases (`main.js`, `manifest.json`, `styles.css`).
