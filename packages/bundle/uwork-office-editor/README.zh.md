---
description: "可选的 UWork Word 文档编辑与文件保存。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-uwork-office-editor

[English](README.md) | 中文

## 概述

在 dsh 文件标签页中编辑 Word 文档，并在关闭或重新载入前决定如何处理未保存修改。保存使用文件版本检查，拒绝覆盖外部修改。

## 目录

- [使用此包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

此可选层在 Web 或 Desktop profile 的基础层之后选择，未加入普通 dsh 默认配置。它装配 Office 文件 Host 服务及编辑器 Client 插件。

```json
{ "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@deepseek-ai/dsh-uwork-office-editor"] } } }
```

本地开发验证使用指向工作区包的 profile 依赖；此包尚无经验证的公开注册表安装路径。包管理器安装与卸载验收仍未完成。

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现细节</summary>

编辑器模型和完整字节只保留在标签页生命周期中。异步导出先捕获独立快照；写入确认不会清除之后产生的修改。插件释放会取消并等待活动操作，再销毁编辑器。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [Office](../../../docs/subsystems/uwork-office-editor.zh.md)
- [Filesystem](../../fs/fs/README.zh.md)
- [Sidebar](../../client/ui-sidebar-right/README.zh.md)

<a id="model-experience"></a>
## 模型体验

无；文档编辑与保存不增加模型输入或 Session 事件。

#### KV Cache 影响

无。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 当前 Client 仅接管 DOCX。XLSX、PPTX 编辑和完整 Word 工具栏及审阅控件仍在迁移中。
- 原生另存为、应用退出协商、强制终止草稿恢复和签名桌面安装包验收尚未实现。
- 文件操作限于 Session 工作区。只读策略禁止编辑。无效导出保留当前修改且不会写入。
- DOCX 保留测试验证 ZIP 和 XML 元数据，不代表 Word/WPS 重开保真或 Windows x64、Mac ARM 验收。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护上下文</summary>

无。

</details>
