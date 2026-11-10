---
description: "基于原生对话控件的 UWork 展示。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-uwork-conversation

[English](README.md) | 中文

## 概述

为原生消息、工具摘要、附件和常驻输入框提供 UWork 展示。插件通过透明 Hoc 层与现有品牌、审批和问题层组合，保留原生渲染、模型选择、草稿、排队、上传控件及 Session 行为。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与待办工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

仅在 UWork 产品层加载，并依赖 `ui-renderer`、`ui-conversation` 和 `ui-theme`。本包分别向 `conversation.hero.frame` 和 `conversation.composer.frame` 注册独立的 `uwork-conversation` 与 `uwork-composer` 层。两层都使用 `display: contents`，准确渲染已有子内容一次，并在主页或交互状态变化时保留组件身份。卸载插件会移除所属层和调色覆盖。

<a id="understand-the-implementation"></a>
## 理解实现

源参考为 UWork 的 `components/ai-elements/message.tsx`、`prompt-editor/ChatPromptEditor.tsx`、`v4/ConversationComposer.tsx` 和 `ToolCallBlocks/ToolSummaryRow.tsx`。源 Zai 调色通过原生主题覆盖 API 提供用户消息填充：浅色 `#e6e6e6`、深色 `#363636`。

组件拥有者支持的 CSS 变量设置用户消息 8px 圆角和 12×16px 内边距、输入框 16px 圆角及 12px 顶部内边距和行间距、附件 48px 预览及 8px 圆角，以及与正文同字号的工具摘要。文件卡片内部纵向内边距为 4px，让文件名和元信息容纳于更小的预览高度。未加载本插件时，每个组件仍使用原有回退值。发送控件使用现有主按钮填充、悬停和反色文字角色，原生禁用、加载和停止状态不变。本插件不使用业务 DOM 选择器，不添加全局样式表，也不复制渲染树。

原生内容宽度控制、字号偏好、菜单、焦点、灯箱、工具展开、流式状态和错误展示继续生效。目标可调整宽度轴予以保留，不复制源状态面板的宽度与平移规则。

<a id="model-experience"></a>
## 模型体验

无，因为本插件只改变展示，不添加模型输入、工具或 Session 事件。

#### KV Cache 影响

本插件不改变请求、消息顺序、保留历史或缓存键。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 源产品字号和紧凑附件几何通过原生组件实现。源特有的状态面板平移和另一套对话业务树不予复制；原生宽度调整和组合行为保持权威。

### 开发备注

几何变量由对应组件拥有者维护。需要其他源展示处理时，应扩展已记录的变量，不要选择其他插件的内部类名或替换其有状态控件。
