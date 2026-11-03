# Crisp Launchpad 分工契约

2026-11-03 作者确认：行动以 Crisp Tempo 为准；同日决定删除 `Now/` 行动层（Launchpad 0.4.0）。Launchpad 做 ANKS 总控台，具体的事交给对应插件。

## 谁管什么

| 插件 | 负责 | Launchpad 的做法 |
| --- | --- | --- |
| Launchpad | 系统状态、内容流水线、知识、复盘、待整理、插件入口 | 主体 |
| Tempo | 行动的唯一来源 | 读 `getActionOverview()`；新建走 `createTaskFromSource()` 或 Tempo 的快速新建；点开走 `revealTask()`。完成、改期、删除只在 Tempo 里做 |
| Pulse | 速记 | 速记入口打开 Pulse 速记；Pulse 没开时用 Launchpad 自带速记（只写 `raw/inbox`） |
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
