---
description: "原生审批和询问 composer 的 UWork 表面展示。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-uwork-interactions

[English](README.md) | 中文

## 概述

为原生审批、询问及计划审查 takeover 应用 UWork 表面展示。决策、请求生命周期、键盘、回答重试及询问草稿仍由原生 owner 持有。

## 目录

- [使用此包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

在原生 Conversation 与交互包之后选择此可选展示。它只贡献 `conversation.composer.frame`，不替换 chain entry，也不注册第二个决策监听器。卸载时撤销贡献。

<a id="understand-the-implementation"></a>
## 实现说明

root 作用域 HOC 接收通用 `interactionKind` 与原样原生 children。普通与 pending 状态保持相同布局中立 wrapper，因此交互类型变化不会重新挂载常驻输入。只有 approval、question 和 plan-review 应用交互角色；无关交互保留原生外观。

源 UWork 的 `PermissionDialog.tsx` 与 `ElicitationDialog.tsx` 使用 rounded-2xl popover 卡片及轻阴影。此适配只在原生 composer seat 内应用 16px 卡片圆角、语义 popover 表面与紧凑 elevation。保留警告色、焦点提示、滚动上限、动作顺序和原生控件。浅暗表面沿用应用语义色板，不导入源 RPC、store、选项语义或模态生命周期。

<a id="model-experience"></a>
## 模型体验

无，因为此包只改变原生交互展示，不构造模型消息、schema 或工具结果。

#### KV Cache effect

模型请求前缀不变。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 计划审查布局、中文文案及实际应用失败/过期状态仍需独立渲染检查；此切片不代表 T21/T22 完整验收或真实桌面平台验收。

### 开发备注

测试在产品 wrapper 内执行原生审批允许、拒绝、Escape 与重试，验证 takeover 变化时常驻输入 DOM 身份不变，以及延迟声明挂载与撤销。共享 Conversation skeleton 保留已有常驻 composer 检查。浏览器场景通过原生 UI 选择 fixture 模型，在补入唯一显式选择事件后保持完整回放比较，并截取实际组合页面。

已在实际 Web 组合中以回放的原生审批与询问请求检查浅暗、1280px/390px、长审批内容、可达 footer 动作、提交及精确持久化回放。
