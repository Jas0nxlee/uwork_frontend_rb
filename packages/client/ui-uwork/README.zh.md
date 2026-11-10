---
description: "UWork 侧栏品牌与空白首页。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-uwork

[English](README.md) | 中文

## 概述

在侧栏显示 UWork 字标，并为空白首页提供 U 标记、标题与 UCAS 背景。浅暗主题沿用应用文字颜色；进入会话时移除装饰而保留输入框。

源 UWork 的浅暗中性配色通过原生主题服务应用于主界面、侧栏、输入框及导航状态。现有主题偏好、状态色、焦点指示、字体设置及原生 Agent presets 继续由各自原有模块负责。

桌面展开导航通过 `sidebar.frame` 采用紧凑呈现。原生侧栏继续负责操作、折叠、焦点及工作区与会话状态；移动抽屉和折叠轨道保留原有几何。

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

一个随插件生命周期释放的 `theme.overrideTokens` 图层将源 Zai 配色映射到语义角色。它跟随浅色、暗色及系统主题变化，不写入用户偏好；卸载时恢复原配色。

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

- 此包负责品牌、首页装饰、中性主题角色及紧凑桌面导航；对话、交互及工作台几何由各自的 UWork 呈现包负责。
- 不负责原生安装图标、窗口菜单或企业登录。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
