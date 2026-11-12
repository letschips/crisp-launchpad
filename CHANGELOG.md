# Changelog

## 0.12.1 — 2026-11-12

- 修复：插件更新或重新启用后，「启动时打开」会再开一个启动台标签，或把启动台切到前台；现在只在 Obsidian 启动时打开。

## 0.12.0 — 2026-11-12

- 优化：「Crisp 工具」改成按捕获、规划、检索、创作分列，每个入口整行可点、图标更醒目；窄面板自动变成两列或一列。

## 0.11.1 — 2026-11-12

- 修复：Obsidian 重启或插件更新后，启动台标签还没加载好时，用命令「新建内容项目」或「速记」，弹窗可能拿不到启动台；新建内容项目会在项目已经建好后报错。现在先等启动台和侧栏面板加载完成再继续。

## 0.11.0 — 2026-11-11

- 新增：内容项目可以填「计划发布日」（新建和推进弹窗），写进 `project.yaml` 的 `planned_publish_at`，手写的控制卡也会补上这个字段。
- 新增：填了计划发布日会在 Crisp Tempo 建一条带截止日期的「发布：项目名」行动（需要 Tempo 0.17.0）；改期时只有 Tempo 里的截止日期没被你改过才跟着改，清空同理。没有 Tempo 或版本太旧时只保存日期并提示。
- 新增：创作页的项目行显示「距发布 N 天」，3 天内和已过期的分别标色；已发布的不显示。
- 新增：把项目标为已发布时，如果 Tempo 里那条「发布」行动还没完成，会提示一句。

## 0.10.1 — 2026-11-11

- 修复：Obsidian 开着过夜后，倒计时和「今天」的行动停在前一天；现在过了零点、或窗口回到前台时发现换日，会自动重画。

## 0.10.0 — 2026-11-11

- 新增：行动面板「今天」页签多一个「临近截止」分区，列出未来 7 天要截止的行动，按剩余天数排序；没有时不显示。
- 新增：行动台、行动收口和行动面板里，未完成行动的截止日期显示为倒计时（「还剩 N 天」「明天截止」「今天截止」「逾期 N 天」），3 天内和逾期的分别标色，确切日期在悬停提示里。
- 修复：行动台的逾期行动只显示日期，没有「逾期」字样。

## 0.9.1 — 2026-11-04

- 修复：标为已发布时，`publication_status` 和 `published_at` 被追加到 `publish.md` 正文末尾；现在只写进 frontmatter，`article.md` 也补上发布日期，「最近产出」按发布日期排序。
- 修复：推进内容项目时手写过的 `project.md` 会被重建覆盖；现在同步改它的 frontmatter，推进后跑一次 ANKS 校验，未通过会提示。
- 修复：创作页的阶段读 `article.md`，和推进弹窗不一致；现在以控制卡为准。
- 修复：待整理「标为已处理」后仍被 ANKS 报「无法自动归位」；收件箱根目录的笔记标记时补上 `inbox_type`。
- 修复：知识页「产出」把项目控制卡、发布记录、标题候选、QA 和健康日志算进去；「近 7 天更新」上下两个数不一致。
- 修复：新建、推进内容项目时事件桥同时跑一组 ANKS 命令。
- 修复：侧栏没连上 Tempo 时显示「今天没有排期行动」；书签短链接在侧栏打不开。

## 0.9.0 — 2026-11-04

- 速记归 Crisp Pulse 判断：Pulse 的速记日文件不再算「待整理」（今天一行、知识页、侧栏同一口径）。
- 今天一行的「速记待处理」改为近 7 天还没转成任务或笔记的速记（需要 Crisp Pulse 1.43.0+，旧版仍显示今天的数），「待你判断」多一行；点开直接进 Pulse 速记面板，只看这些。

## 0.8.0 — 2026-11-04

- 复盘页去掉按文件修改时间画的 53 周热力图和「更新日期占比」，改为「近期节奏」：读 Crisp Pulse 的每日贡献分（需要 Pulse 1.42.0+），可切 7 / 30 / 90 天，没记录的日子画成斜纹，不当成 0；汇总有产出天数、连续天数、专注时长和完成任务，可直接打开 Pulse。
- 系统页问题清单按类型归组：阻塞 → 待办 → 提示，同级按数量排序，阻塞组默认展开；问题类型显示中文；「超过 3 天未整理」「待回写」「在制内容过多」带入口直达对应页面。
- 问题行只写文件名和所在目录，窄面板不再把长路径折成多行。

## 0.7.0 — 2026-11-04

- 「新建行动」直接在启动台弹出 Tempo 的新建任务弹窗，不再先跳到 Tempo（需要 Crisp Tempo 0.14.0+；旧版仍会打开 Tempo）。
- 「待整理」统一为全库未归位材料：今天一行、知识页 KPI 和待整理卡片是同一个数；KPI 副标题写出各 Topic 的分布，待整理卡片列出全部 Topic 的材料，可展开全部。
- 复盘页和「待你判断」里来自 ANKS 健康检查的积压改叫「超过 3 天未整理」，和「待整理」分开。
- 创作页「内容流向」加阶段图例（阶段名和数量，点一下跳到该阶段）；每个项目显示几天未动，发布前阶段超过 14 天标橙色。
- 更新插件后启动台标签留在原位，不再被挪到最后或多开一个。
- 知识页「本周知识库活动」改为「近 7 天更新」，没有类型的笔记写「未标类型」；当天的材料显示「今天」。

## 0.6.0 — 2026-11-04

- 卡片改成和 Crisp Pulse 一致的两层结构：外层托盘带图标块，内容放在内层面板；页签改成分段控件，顶部标题不再是卡片。
- 今天页最上面新增「今天一行」：行动、Tempo 今天完成、Pulse 贡献分和连续天数、速记待处理、待整理，每项可点；读不到的项不显示，不当成 0（今天完成需要 Tempo 0.6.0+）。
- 行动台的六格计数改成分段控件（全部 / 逾期 / 今天 / 等待 / 即将 / 随时 / 收件箱），逾期为 0 时不显示；头部只留「新建行动」「打开 Tempo」，退回快照时才显示快照时间和刷新按钮。
- 「待你判断」从胶囊改成列表，按数量排序，点一行进复盘页。
- 内容状态和系统问题级别显示中文（草稿 / 搁置 / 已发布 / 已废弃，阻塞 / 待办 / 提示）。
- Pulse 分数、连续天数或速记变化时，启动台自动刷新。

## 0.5.0 — 2026-11-03

- 保留已发布项目的原发布日期；多文件状态更新失败时恢复本次写入，并保护并发修改。
- 材料转行动按来源路径去重；复盘先核对 Tempo 最近 14 天的完成记录，预览确认后写入并保留来源。
- 修复中文输入法确认键误提交，以及后台刷新打断捕获输入的问题。
- 侧栏显示全库待整理总量并支持查看全部；系统页展示完整问题清单，创作阶段可展开全部项目。
- 页签按需渲染，首页补充接下来可做的行动；统一主题颜色和侧栏按钮，调整文件更新统计名称。
- 设置保存串行写入并回读校验，失败时明确提示。

## 0.4.0 — 2026-11-03

- 删除 `Now/` 行动层：Now 看板、行动编辑弹窗、行动提醒、`obsidian://crisp-now`、「打开 Crisp Now 行动看板」命令和功能区图标都已移除。行动只认 Crisp Tempo；没有 Tempo 时行动台提示启用并激活。
- 速记弹窗只保留速记，新建行动改用 Tempo 的快速新建。
- Tempo 任务变化时，事件桥顺带重建行动快照。

## 0.3.0 — 2026-11-03

- 装了并激活 Crisp Tempo 时，行动以 Tempo 为准：行动台、侧栏面板、复盘都读 Tempo，新建行动写进 Tempo，点行动在 Tempo 里打开；没有 Tempo 时照旧用 `Now/`。
- 速记交给 Crisp Pulse；Pulse 没开时用自带速记。
- 「今天」页新增 Crisp 工具入口，按捕获 / 规划 / 检索 / 创作分组，只显示已启用的插件。

## 0.2.15 — 2026-10-09

- 行动台标题旁新增「负荷 N/上限」徽章：N = 今天 + 逾期，超过上限时显示警示态。上限取自 `actions.json` 的 `load.limit`（`Now/` 文件 frontmatter 的 `wip_limit`，默认 5），计数跟随实时 Now 数据，不受旧快照影响。

## 0.2.14 — 2026-09-30

- `data.json` 损坏无法读取时（例如同步冲突或写入中断），先备份为 `data.json.unreadable-<时间>` 再恢复默认设置，避免设置被静默覆盖；无法备份时本次运行不保存设置。

## [0.2.13] - 2026-09-27

- Read the action card from current Now files on desktop as well as mobile, so equal-count edits and emptied action files cannot be hidden by a stale snapshot.
- Refresh local views after vault creation, modification, rename, and deletion even when CLI automation is disabled; coalesce duplicate metadata events.
- Add render and vault-event regressions for stale action data and disabled automation.
- Review suggestions now also deduplicate against actions completed in the last 14 days. Ticking an action does not clear the ANKS finding behind it (`knowledge_writeback`, inbox status), so the same first two write-back and inbox items were regenerated on every click and later findings never surfaced.
- The event bridge rebuilds `content-projects/index.md` when a project is deleted, renamed, or edited outside the plugin, so the derived index no longer keeps links to removed projects (`BROKEN_LINK_PATH`).
- Creating or advancing a content project now re-materializes `project.md` before rebuilding snapshots. `anks_core` reads `project.md` first, so the old order built the content snapshot from the previous stage.
- When `project.yaml` changes outside the plugin, the event bridge re-materializes `project.md` only if it is a generated card (title plus the four generated fields). Hand-written cards are left alone; ANKS still reports them as `CONTROL_CARD_STALE`.
- Router ignore prefixes are read from `routing-rules.toml` at startup and whenever that file changes. The built-in list is only a fallback, and a local test fails if it drifts from the vault.
- After a successful health rebuild, open `处理系统阻塞：CODE` actions whose blocking finding is gone are completed automatically, using the title as the write anchor.

## [0.2.12] - 2026-09-23

- Manual action and system snapshot refreshes now record component attempts, successes, and failures. A successful refresh clears only the components it rebuilt.
- Moving an action to “随时” clears due, scheduled, start, and time markers while preserving its creation date and project.
- A failed action snapshot refresh no longer reports a committed action as failed. The board switches to current Now data and offers an explicit snapshot refresh path.
- Removed the broad two-second Now event suppression. Other Now file changes remain queued for a coalesced snapshot refresh.
- Added regression coverage for all four fixes and the live-data fallback.

## [0.2.11] - 2026-09-21

- Stops the plugin from fabricating ANKS structure in a vault that has none. Quick Capture fell back to `self-media` in three places (`listTopics()`, `captureTargetTopic()`, and the panel/quick-capture defaults), so capturing in a vault without `Topics/` silently created `Topics/self-media/raw/inbox/<type>/`. Capture now resolves its topic from the vault's real topics, returns empty when there are none, and the write path refuses a topic whose folder does not exist.
- Verified in a real 58-file vault with no `Topics/`: the folder is no longer created, the call is rejected with 尚未配置 Topic, and the panel shows that message with 记下 disabled.

## [0.2.10] - 2026-09-20

- Replaces the DSH status pill with a kernel status pill. The old pill reported whether *another plugin* (crisp-dsh) was enabled — not a prerequisite of this product — so anyone without it saw "DSH 离线" and read it as breakage. The pill now reports whether this vault's own kernel (`Sidecar/bin/anks`) can do work: 内核就绪 / 内核缺失 / 移动端只读, each with a tooltip explaining what is and is not available. Hidden entirely in the actions-only profile, where there is no ANKS context at all.
- Makes the interface adapt to the vault instead of assuming the author's setup. A new detection layer reads the vault's **structure** (`system/<platform>/templates/content-project/`, `system/<platform>/profiles/*.yaml`, `content-projects/`, `knowledge/`, `raw/inbox/`, `*.base`, `*大盘*.md`) and resolves one of three workspace profiles: 内容运营 / 知识管理 / 仅行动. Nothing keys off a platform name or a topic name, so renaming either keeps working.
- Adds a 工作台形态 setting (自动 by default) with a plain-language summary of what detection found. Explicit choice always wins; unknown values fall back to auto. Detection re-runs on every render, so creating `Topics/<x>/content-projects/` makes the 创作 tab appear without touching settings.
- Adapts the visible surface per profile: tab set, hero title, the DSH status pill (hidden when the vault has no ANKS context, where "DSH 离线" reads as breakage), which KPIs exist, whether the 待整理 / 最近产出 cards and the four object-layer stats render at all, and every KPI's jump target (resolved from the detected primary topic instead of a hard-coded `self-media`).
- Tab persistence now validates against the active profile, so a remembered `create` tab cannot strand the view on a page the current vault no longer supports.
- Adds `tests/workspace-profile.test.cjs` (detection, profile resolution, KPI mapping, malformed input) and a render assertion that the three profiles really produce three different tab sets.

- Unifies the "unknown time" rule across the date helpers. `mtime` of `0` is a sentinel meaning "no `stat.mtime`" (`pageRecord` falls back with `|| 0`), but `dateKeyFromTimestamp` read it as *today* while `daysBetween` read it as *1970*, so the same page showed up as "active today" in the heatmap and as "20776 天前" in the 待整理 card. A single `knownTimestamp()` predicate now decides what counts as a usable time; unknown is never rendered as a date — `dateKeyFromTimestamp` returns an empty key (so the page belongs to no day), `daysBetween` returns `null` and the caller shows 时间未知, `formatShortDate` / `formatDateTime` keep returning `–`.
- Fixes a `ReferenceError` that made the Crisp 行动面板 crash on its default tab: `CrispPanelRenderer.renderToday()` had lost its `parent` parameter while `render()`, `renderCapture`, `renderTriage` and `renderBookmarks` still passed one, so 今天 threw before rendering anything.
- Adds `tests/render-smoke.test.cjs`: a zero-dependency render smoke suite (minimal fake DOM + snapshot-shaped fixtures) that renders all three views and every tab on both desktop and mobile paths. It closes the coverage hole both historical P0s slipped through — verified to fail on a re-introduced `renderToday()` signature drop and on a re-introduced `Date`-only `formatDateTime`.
- States the retirement of the DataviewJS launchpad in the README instead of describing it as an acceptance-testing fallback.
- Turns the 系统节奏 heatmap from decoration into a temporal index. Clicking a day opens an inline detail: object-type breakdown plus the files changed that day (time, title, path), each row clickable. The most recent active day is selected by default, so the block is never an empty box waiting for a hint.
- Materializes the missing project control cards. `anks content control-card` builds `project.md` from `project.yaml` — key-aware, so it never duplicates `type` / `artifact_type` / `content_role` that 13 of the existing yaml files already carry; refs are absolutized and the body matches the shape of the one hand-written card. All 14 yaml-only projects now have a card, and the index links point at them.
- Keeps the card honest: `anks_core` prefers `project.md` as the control file, so the plugin re-materializes it (`--force`) after every stage/status change instead of letting tooling read a stale card. `--force` requires an explicit project argument, so it can never mass-overwrite hand-written cards.
- Fixes the readability that exposes: `project.md` / `article.md` / `index.md` are generic filenames, so every list showed "project". Labels now fall back to the parent-qualified name (`SUBSTRATE-SYNTHESIS-ANKS · project`) in the rhythm day detail and the recent-outputs list, and `project` joins the generic-name set that review suggestions already used.

## [0.2.9] - 2026-09-20

- Closes the last of the four content-project state surfaces: `content-projects/index.md` now gets rebuilt through the new `anks content index` command after creating a project and after every stage/status change, instead of being left to drift.
- The index rebuild is derived, not hand-maintained: rows come from each project's control file (`project.md` preferred, `project.yaml` fallback, matching `anks_core`), sorted by `content_id`. A rebuild failure is logged but never fails the project write.

## [0.2.8] - 2026-09-20

- Narrows the event bridge to the router's real scope. Paths under `routing-rules.toml`'s `ignore_prefixes` — content projects, `Core/System/`, `Core/Indexes/` and friends — are now classified as `snapshot` instead of `knowledge`, so `route fix` is no longer spawned for changes the router explicitly skips.
- Splits the snapshot rebuild by cost. A `health` rebuild scans the whole vault (~3.4s) while `content` + `index` together take ~0.2s, so content-project edits now rebuild only `content,index` and coalesce the `health` refresh into a single trailing rebuild 90 seconds after the last edit. A routable-path change still does a full rebuild and cancels the pending one.

## [0.2.7] - 2026-09-20

- Fixes a lost-update race on `Now/行动.md`. Every mutation is a read-modify-write of the whole file, so two concurrent mutations — ticking two actions quickly, or a panel tick racing a board tick — meant the second write was built from a stale read and silently reverted the first. Mutations now run through one serial queue shared by the panel, the board, drag-and-drop and the edit modal.
- Stops the action parser from eating inline `#tokens` out of titles: `修复 #123 的 bug` was read back as `修复 的 bug` and the token was re-emitted at the end of the line. Only plugin-managed tags (`#project/…` and the waiting set) are still stripped and re-emitted; anything else stays where it was written.
- Preserves the action file's newline style, so a CRLF file is no longer rewritten to LF by the first tick.

## [0.2.6] - 2026-09-20

- Fixes two orphan-timer leaks: the reminder loop's boot timeout was never cleared, and the `onLayoutReady` callback could still start the loop after the plugin had been unloaded — leaving an interval that read the vault every 30 seconds with nothing able to stop it. The loop, the event bridge's reschedule and the reminder check now all bail out once unloaded.
- Stops `taskLine` from silently rewriting project tags: a nested tag such as `#project/知识/回写` was written back as `#project/知识-回写`. Slashes are now preserved; only whitespace and `#`, which would break the tag token, are normalised.
- Aligns the 待整理 rule with the ANKS vault sweeper: `processed`, `archived` and `done` all count as filed (case-insensitive), so the panel and the Launchpad KPI no longer disagree with `health`.
- Remembers the 系统状态 drawer state instead of collapsing it on every refresh, and hides the redundant 捕获 button while the 捕获 tab is open.
- Removes the dead `renderOverview` shim left behind by the 总览 → 今天 rename.

## [0.2.5] - 2026-09-20

- Reworks the Crisp 行动面板 around ANKS's own loop instead of a single action list: tabs 今天 / 捕获 / 待整理 / 收藏, with the active tab remembered per device.
- 捕获 tab: inline capture (Enter saves, Shift+Enter adds a newline) with a 速记 / 灵感 / 链接 switch. It writes through the existing ANKS capture contract into `Topics/<topic>/raw/inbox/<type>/`, shows the exact target folder, and lists the day's captures below.
- 待整理 tab: lists `raw/inbox` items whose `routing_status` is not `processed` — the same rule the Launchpad KPI uses — and opens the existing ANKS conversion modal on tap (转为行动 / 标为已处理 work on mobile; 转为选题 stays desktop-only).
- The panel header now reports 今天 / 等待 / 待整理 and states the loop it serves: `捕获 → 待整理 → 行动`.

## [0.2.4] - 2026-09-20

- Retires the system-dashboard landing: the first tab is now 今天 (id `today`), a stored legacy `overview` tab migrates to it automatically, and the hero card no longer carries the health strip.
- Moves the system health strip behind a collapsed 系统状态 drawer on the 今天 page, so the first screen answers "今天做什么" and the health detail drops to the second layer.
- Adds the Crisp 行动面板 sidebar view (`crisp-launchpad-panel-view`) as a single entry point: 今天 (overdue/today actions with inline completion), 速记, 新建行动, 打开 Now 看板 / 打开启动台, and 收藏 read from the core Bookmarks plugin. Open it from the settings, the command palette, or the 系统 tab.
- Introduces shared Crisp design tokens (`--crisp-accent` / `-surface` / `-border` / `-radius*` / `-space*` / `-dur*` / `-ease`) scoped to the Launchpad, Now and panel views, and aliases `--pulse-ui-*`, `--now-accent` and `--lp-radius-*` onto them so the three surfaces finally share one radius, spacing and motion scale.

## [0.2.3] - 2026-09-20

- Adds a full time model to Now action lines: `🛫 计划开始` / `⏳ 排期` / `📅 截止` / `⏰ HH:MM`. The parser validates real calendar dates and 24-hour times, so malformed values are dropped instead of being written back to `Now/行动.md`.
- Stamps `✅ 完成日期` when an action is completed and clears it when restored. Completed actions now land in the Now board's 已完成 bucket instead of disappearing into a collapsed section, show their completion date, and can be completed by dropping a card onto that bucket.
- Adds due-time reminders: while Obsidian is running the plugin checks `Now/` every 30 seconds, sends a system notification when an action with `⏰` comes due, and falls back to an in-app notice when system notifications are unavailable. Each reminder fires once, and reminders older than 12 hours are not replayed.
- Adds 计划开始 and 提醒时间 fields to the action editor and validates their format before saving, so typos surface immediately instead of silently losing data.
- Reports the completed count alongside open actions on the Launchpad action card.

## [0.2.2] - 2026-09-20

- Removes the Hero version subtitle (`套件 V9.0 · 内核 V2.2.0 · 插件 … · Topics …`) for good, along with its `parseHeroVersions` parser, the styling and the Start Here / AGENTS reads that fed it. A static gate now fails if it is reintroduced.
- Fixes the Launchpad brand icon rendering: it previously had no persistent element, so it rasterized as fully blank whenever the ripple animation was not advancing and vanished for a slice of every cycle. It now keeps a solid core and runs three overlapping ripple rings with no blank window, and the restart no longer waits for the last ring to end.
- Adds static icon fallbacks for both Crisp Launchpad and Crisp Now and registers them when the user prefers reduced motion, since SMIL animations ignore the CSS media query.
- Returns the CLI stdout from `runAnks` instead of discarding it inside a bare `await`, so callers can inspect command output.
- Strengthens the static audit gate: `snapshotAge` callsites must read `…generated_at`, and every `updateNowTask` / `deleteNowTask` / `toggleNowTask` callsite must pass a title anchor.

## [0.2.1] - 2026-09-20

- Fixes double Now board re-entrance and visual glitch by introducing view render nonces and silencing self-triggered bridge cycles.
- Fixes review suggestion queue deadlock (F1) by only counting quota after deduplication against existing Now tasks.
- Aligns new content project templates with the live ANKS contracts: initial stage defaults to `intake`, and `sop_version` updates to `@2026-09-14`.
- Closes the loop on inbox processed state (F4): vault sweeper supports ISO millisecond timestamps and ignores processed items; quick capture and inbox conversions supply canonical raw metadata.
- Integrates live action tasks directly on mobile and environments without snapshots (F5/F15), removing stale or misleading counts.
- Synchronizes content project progression across `project.yaml`, `article.md`, and `publish.md` (F8), setting `publication_status: live` on publish.
- Restores 53-week rhythm heatmap month and weekday tick markers (`.launchpad-heat-scroll`, `.launchpad-heat-months`, `.launchpad-heat-weekdays`) and hover detail dates (F10).
- Decouples `formatDateTime` (UI timestamps) from `formatFullDateTime` (ISO frontmatter stamps), eliminating `getFullYear is not a function` runtime errors (NEW-1).
- Hardens Now action mutations with title verification and automatic line-shift recovery to prevent concurrent edits from corrupting adjacent tasks (NEW-2).
- Fixes event bridge dirty-flag semantics (N1/N2): sets dirty flag before gating to never discard edits during runs, removes redundant 60s cooldown, and defers next execution via finally.
- Fully aligns WeChat content project template and generator with live contracts (N3): adds `profile`, `theme`, `source_ledger_ref`, and `public_disclosure`.
- Hardens processed inbox markers (N4): ensures canonical `type: raw`, `topic`, `owner`, and `title` are fully injected into notes with incomplete or missing frontmatter, clearing unroutable warnings.
- Action card badge honestly reflects snapshot age and live divergence (N6), showing exact freshness or warnings when stale.
- Adds touchscreen guidance in Now board subtitle for mobile users (N7).
- Adds regression test in Sidecar `test_vault_sweeper` ensuring processed/archived inbox notes are excluded from stale warnings (N5).
- Fixes drag-and-drop bucket transition in Now board: passes `taskTitle` in `moveTaskToBucket` signature preventing runtime `ReferenceError`, ensures atomic `.now-board` DOM uniqueness, and adds drag-click suppression on task cards.
- Fixes action editing in `NowTaskEditModal` (NEW-P1-B): preserves `initialTitle` anchor so users can rename or safely delete tasks without being rejected by external-shift title verification.
- Fixes snapshot age calculation in overview badge (NEW-P2-C): defensively extracts timestamps from snapshot objects preventing "时间未知" perpetual fallback, and hardens date helpers against invalid dates.
- Fixes review suggestion generic document name collapse (R5 & R6): qualifies generic basenames (`article`, `index`, etc.) with cleaned parent folder names so pending writebacks across content projects do not deduplicate into a single entry; adopts concise neutral phrasing `回写待提炼：` with backward-compatible normalization.
- Eliminates dead CSS classes and introduces automated static audit suite (`tests/static-audit.test.cjs`) covering duplicate declarations, CSS class bi-directionality, and helper callsite argument shapes.
- Replaces Crisp Launchpad and Crisp Now default Lucide icons with animated custom brand SVGs: multi-pulse ripple animation for Launchpad and 3-dots rotating orbit animation for Now.

## [0.2.0] - 2026-09-19

- Adds an opt-in event bridge for `Topics/`, `Core/`, and `Now/` changes with debounce and single-flight execution.
- The bridge only runs `route fix --min-confidence 1`; Core promotion is never enabled automatically.
- Adds a unified review tab for actions, pending writebacks, stale inbox items, and reviewing content projects.
- Generates up to five deduplicated next actions into `Now/行动.md`.
- Enables mobile installation and Markdown-native quick capture, Now board, and content-project editing.
- Keeps CLI-backed refresh, repair, and topic conversion desktop-only with explicit disabled states.

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
- Adds native content-project creation and stage/status progression.
- Adds direct entry to the prepared Crisp Base content overview.
- Hardens inbox processed marker against CRLF newlines to prevent frontmatter duplication.
- Fixes heatmap range dimming to preserve data-level activity contrast without flattening to solid borders.
- Augments PATH environment resolution for ANKS CLI commands under macOS GUI Obsidian.
