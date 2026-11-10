---
description: "在原生设置中安全呈现 UWork 企业账户。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-uwork-enterprise

[English](README.md) | 中文

<a id="summary"></a>
## 概述

在原生设置面板中显示经过验证的企业账户、公开组织名称、受管模型状态、刷新与退出操作。凭据和签发方验证由 Host 负责；此包只接收安全的生成式身份投影。

## 目录

- [使用此包](#use-this-package)
- [实现](#implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

装配 [UWork desktop bundle](../../bundle/uwork-desktop/README.zh.md)，在设置中打开企业账户。如需切换组织，请退出后在原生登录窗口选择组织。此包没有配置字段。

<a id="implementation"></a>
## 实现

生成的 `uworkIdentity` Remote 仅公开 `getState`、`listOrganizations`、`signOut` 及安全的 `watchState` 流。标准 `useResource` hook 读取账户及模型 provider。账户 provider 跨窗口观察安全身份变化。资源地址包含原生连接代次，使断线或 Host 更换立即清空之前的账户与模型事实，重新连接时开启新流。资源模型负责共享、取消及过期帧拒绝，私有 store 只保存 mutation 交互状态。

资源流失败时可以保留之前的详情，并明确显示验证失败；显式刷新开启新的资源代次。退出失败或结果未知时保留账户投影并提示刷新，不假定凭据已经移除。页面不呈现诊断信息、凭据值、授权 URL 或回调数据。退出后返回登录由原生 Main 进程负责。

模型读取仅调用不会创建密钥的安全刷新方法。创建受管密钥需要先阅读说明服务端创建行为的独立对话框，再点击确认按钮。挂载、重连、刷新和重试均不创建密钥。创建结果未知时阻止再次创建，直到同一连接和账户在操作完成后的新读取确认模型已就绪或能力待补充。就绪状态列出已发布模型，仅在 Host 报告缺少默认模型时提示用户选择。

<a id="further-exploration"></a>
## 延伸阅读

- [企业身份](../../credentials/uwork-enterprise/README.zh.md)
- [Settings](../ui-settings/README.zh.md)
- [UWork 呈现](../ui-uwork/README.zh.md)

<a id="model-experience"></a>
## 模型体验

无，因为账户呈现不添加模型输入。

#### KV Cache effect

无。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 原生授权和嵌入浏览器由 Desktop 负责，不属于此设置页面。
- 组织切换由原生登录窗口负责；此设置页面不提供授权 URL 或回调控件。

<a id="dev-note"></a>
### 开发备注

资源模型负责实时读取的生命周期。身份 mutation 不包含传输取消参数；受管密钥创建使用生成的取消信号，并保留 Host 的未知结果保护。
