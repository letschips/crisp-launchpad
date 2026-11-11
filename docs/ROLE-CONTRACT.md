# Crisp Launchpad 分工契约

2026-11-03 作者确认：行动以 Crisp Tempo 为准；同日决定删除 `Now/` 行动层（Launchpad 0.4.0）。Launchpad 做 ANKS 总控台，具体的事交给对应插件。

## 谁管什么

| 插件 | 负责 | Launchpad 的做法 |
| --- | --- | --- |
| Launchpad | 系统状态、内容流水线、知识、复盘、待整理、插件入口 | 主体 |
| Tempo | 行动的唯一来源 | 读 `getActionOverview()`；材料转行动走 `createTaskFromSource()`；「新建行动」用 `openQuickAddModal()` 在启动台原地弹出 Tempo 的新建弹窗（Tempo 0.14.0+，旧版退回快速新建命令）；点开走 `revealTask()`。完成、改期、删除只在 Tempo 里做。唯一例外：内容项目的计划发布日（`planned_publish_at`）会建一条「发布：…」行动（来源 `crisp-launchpad:publish-<项目目录名>`，Tempo 0.17.0+），日期变了用 `rescheduleSourceTask()` 带原日期改期，Tempo 里被用户改过的日期不动 |
| Pulse | 速记（每条速记的去处） | 速记入口打开 Pulse 速记；Pulse 没开时用 Launchpad 自带速记（只写 `raw/inbox`）。Pulse 的速记日文件（`capture_type: pulse-memo`）不算「待整理」；「速记待处理」读 `getMemoBacklog(7)`：近 7 天还没转成任务或笔记的条数，点开 `openMemoQuery` 只看这些（Pulse 1.43.0+） |
| 其他 Crisp 插件 | 各自的功能 | 只放入口，只显示已启用的 |

## 没有 Tempo 时

满足全部条件才算连上 Tempo：插件已启用、`actionsApiVersion >= 1`、`getActionOverview().licensed` 为真。

连不上时行动台显示「行动由 Crisp Tempo 管理，请先启用并激活 Tempo」，新建行动、复盘生成行动、待整理转行动都会提示同一句话，不会写到别处。不再有 `Now/` 退路。

## 新建行动的来源标识

材料转行动使用 `crisp-launchpad:source-<哈希>`，哈希取来源路径，同名不同路径不合并；同一路径重试不会重复建。

复盘行动使用 `crisp-launchpad:<日期>-<哈希>`，有来源时哈希包含类别和来源路径，无来源时使用标题。预览和确认时均通过 Tempo 的 `getCompletedOn()` 核对最近 14 天完成记录，历史读取失败时停止生成。完成记录只用于去重，不并入今天的统计；不另存任务历史。

## 事件桥

Tempo 的任务变了会发 `crisp-tempo:state`：视图刷新；事件桥开着时顺带跑 `anks actions snapshot`。

## 命令行快照

`Sidecar/tools/action-snapshot/actions_snapshot.py` 只读 Tempo 的 `data.json`，分桶规则和 Tempo 的 `getActionOverview()` 一致；连不上 Tempo 时输出空快照并在 `warnings` 里说明。

## 速记的口径（2026-11-04）

一个速记日文件里有很多条速记，每条各有去处（转任务、转笔记），所以按文件算「待整理」不对。ANKS 的 vault_sweeper 和 Launchpad 的待整理都不算 `capture_type: pulse-memo` 的文件；还没去处的速记由 Pulse 报告，只看近 7 天，更早的当成记录，不再提醒。
