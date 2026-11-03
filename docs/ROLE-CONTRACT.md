# Crisp Launchpad 分工契约

2026-11-03 作者确认：行动以 Crisp Tempo 为准。Launchpad 做 ANKS 总控台，具体的事交给对应插件。

## 谁管什么

| 插件 | 负责 | Launchpad 的做法 |
| --- | --- | --- |
| Launchpad | 系统状态、内容流水线、知识、复盘、待整理、插件入口 | 主体 |
| Tempo | 行动的唯一来源 | 读 `getActionOverview()`；新建走 `createTaskFromSource()`；点开走 `revealTask()`。完成、改期、删除只在 Tempo 里做 |
| Pulse | 速记 | 速记入口打开 Pulse 速记；Pulse 没开时退回 Launchpad 自带速记 |
| 其他 Crisp 插件 | 各自的功能 | 只放入口，只显示已启用的；读得到的状态顺带显示 |

## 降级

Launchpad 随 Craft 安装包附带，Tempo 不一定装了或激活了。

- 满足全部条件才用 Tempo：插件已启用、`actionsApiVersion >= 1`、`getActionOverview().licensed` 为真。
- 否则退回 `Now/行动.md`：Now 看板、提醒、自动关闭已解除的阻塞行动都照旧。
- Tempo 读失败时退回 `Now/`，只在控制台留警告。

## 新建行动的来源标识

`crisp-launchpad:<哈希>`，哈希取「当天日期 + 行动标题」。同一天重复点不会重复建；隔天同名行动由 Launchpad 按未完成标题去重。

## 命令行快照

`Sidecar/tools/action-snapshot/actions_snapshot.py` 同样优先读 Tempo 的 `data.json`，没有时读 `Now/`。规则和 Tempo 的 `getActionOverview()` 保持一致。
