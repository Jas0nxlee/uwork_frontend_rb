---
kind: upgrade-guide
description: "编辑器准备移除标签页期间，侧栏 closeTarget 可以返回 pending。"
---

# 延迟的侧栏关闭决定

[English](guide.md) | 中文

## 变更

标签页类型注册关闭 guard 后，`SidebarRightController.closeTarget` 新增 `pending` 结果。Pending 表示保存或放弃决定仍在执行，不代表标签页已移除。未注册 guard 的标签页保留同步行为。

编辑插件可以注册 `registerCloseGuard(kind, { prepare, failed })`。已有 `registerCloseHandler` 回调仍在批准后执行同步清理，不是异步保存 hook。批量菜单关闭在首次拒绝时停止。

## 迁移

1. 更新穷举 `closeTarget` 结果的消费方，处理 `pending`，不得将其视为已完成移除或据此关闭原生窗口。
2. 调用方需要等待确认时，使用 `requestCloseIn(sessionId, tabId)`。false 结果会保留标签页。
3. 通过 effect 注册编辑器 guard，在 abort signal 撤回时关闭交互，并通过同步且不抛错的 `failed` 回调展示失败。
4. 应用退出与插件卸载前检查仍需单独执行。这些标签页 guard 不能阻止强制终止；须提前持久化恢复草稿。
