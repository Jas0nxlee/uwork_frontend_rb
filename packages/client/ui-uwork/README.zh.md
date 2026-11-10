---
description: "UWork 侧栏品牌与空白首页。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-uwork

[English](README.md) | 中文

## 概述

在侧栏显示 UWork 字标，并为空白首页提供 U 标记、标题与 UCAS 背景。浅暗主题沿用应用文字颜色；进入会话时移除装饰而保留输入框。

## 目录

- [使用此包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

通过 [UWork bundle](../../bundle/uwork-desktop/README.zh.md) 装配，以同时关闭默认品牌贡献。此插件没有配置字段。

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现内部说明</summary>

品牌通过标准插槽注册，卸载时释放每个贡献和本地化字典。字标与 UCAS 资源使用颜色遮罩，沿用主题语义文字颜色。源 UWork 资产保留 Apache-2.0 许可及来源记录。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [Sidebar](../ui-sidebar/README.zh.md)
- [Conversation](../ui-conversation/README.zh.md)
- [Theme](../ui-theme/README.zh.md)

<a id="model-experience"></a>
## 模型体验

无；品牌呈现不添加模型输入。

#### KV Cache effect

无。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 当前只提供品牌与首页装饰；导航、模式及其余页面布局尚未迁入。
- 不负责原生安装图标、窗口菜单或企业登录。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
