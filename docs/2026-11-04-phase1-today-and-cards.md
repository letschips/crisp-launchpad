# 第一期（0.6.0）：卡片体系与今天页

2026-11-04 作者批准三期升级方案中的第一期。目标：向 Crisp Pulse 的完整度看齐，先统一外观，再重做今天页。分工契约不变（`ROLE-CONTRACT.md`）：行动只读 Tempo，速记交 Pulse，Launchpad 不写第二套数据。

## 范围

1. **卡片体系**：所有页签的卡片改成 Pulse 的两层结构：外层托盘（浅底、20px 圆角）＋卡片头（图标块＋标题＋右侧徽章/按钮）＋内层面板。顶部标题栏和页签改用同一套分段控件。
2. **中文状态**：内容状态（draft / parked / published / deprecated）和系统问题级别（blocking / operational / informational）在界面上显示中文。数据和文件里仍是英文值。
3. **今天一行**：今天页最上面一行摘要，各项只在数据源可用时出现，读不到时不显示（不当成 0）：
   - 行动：Tempo 今天＋逾期（点开 Tempo）
   - 已完成：Tempo `getCompletedToday()`（点开 Tempo）
   - 贡献分、连续：Pulse `getTodaySnapshot()`（点开 Pulse 看板）
   - 速记待处理：Pulse `memos.pending`，`memos` 为 null 时不显示（点开 Pulse 速记）
   - 待整理：全库 raw/inbox 未处理（跳到知识页）
4. **行动台压缩**：6 格计数改成分段控件（今天 / 等待 / 即将 / 随时 / 收件箱，带数量），默认选中「今天」（含逾期）；头部只留「新建行动」和「打开 Tempo」；「实时活数据」徽章只在退回旧快照时显示；「刷新行动」只在退回快照时出现。
5. **待你判断**：低对比度胶囊改成列表行（数量、类别、去处理），点行跳到复盘页。
6. Pulse 状态变化（`crisp-pulse:state`）时刷新视图。

## 不做

- 不改创作、知识、复盘、系统页的数据和逻辑（第二、三期）；只换外观和状态中文。
- 不新增设置项。

## 回归用例（先写测试，后实现）

- 没有 Pulse、Pulse 抛错、`memos` 为 null：今天一行不显示对应项，渲染不抛异常。
- 没有 Tempo 或没有 `getCompletedToday`：不显示行动/已完成项。
- 每张非标题卡片的内容都在内层面板里（结构断言）。
- 状态中文映射：draft→草稿、parked→搁置、published→已发布、deprecated→已废弃，未知值原样显示。
- 行动台分段控件：默认今天；点「等待」只列等待；数量与 Tempo 分桶一致。
- 收到 `crisp-pulse:state` 时调用 `refreshViews`。

## 验收

`npm run check`、`npm run test:e2e` 通过；真实 Obsidian 截图核对浅色/深色、宽/窄面板（≤520px）；同步 ANKS 后发布 0.6.0。
