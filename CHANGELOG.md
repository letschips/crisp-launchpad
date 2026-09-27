# Changelog

## [0.1.0] - 2026-09-19

- Initial native Crisp Launchpad prototype.
- Adds a native Obsidian view with Overview, Create, Knowledge, and System tabs.
- Reads ANKS action, health, content, and index snapshots without DataviewJS.
- Supports explicit one-click snapshot refresh through the local ANKS CLI.
- Adds selectable 4 / 13 / 26 / 52 week rhythm ranges.
- Keeps the full 53-week heatmap context and dims dates outside the selected statistics range.
- Adds native quick capture and new-action modals.
- Adds inbox conversion to action, question card, or processed state.
- Adds a first-run onboarding and environment-repair wizard.
- Adds a native Crisp Now board for viewing, adding, editing, completing and deleting Now actions.
- Hardens inbox processed marker against CRLF newlines to prevent frontmatter duplication.
- Fixes heatmap range dimming to preserve data-level activity contrast without flattening to solid borders.
- Augments PATH environment resolution for ANKS CLI commands under macOS GUI Obsidian.
