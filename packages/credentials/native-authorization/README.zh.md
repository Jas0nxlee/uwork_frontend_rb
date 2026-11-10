---
description: "私有、由产品选择的原生授权提供者注册表。"
kind: "package-reference"
---

# @deepseek-ai/dsh-native-authorization

[English](README.md) | 中文

## 概述

`ctx.nativeAuthorization` 选择产品的原生登录提供者。产品组合先加载此服务，再加载身份提供者；提供者通过 `register()` 注册实现，并用返回的清理函数撤销注册。重复注册会被拒绝。没有提供者时，Desktop 保留标准账号 Welcome。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## 使用此包

在产品身份提供者之前加载此服务。提供者通过 effect 拥有的 `register()` 调用进行注册。私有 Desktop Host 桥接通过 `getProvider()` 获取所选实现；普通产品也可以完全不加载此服务。提交安全状态后，身份提供者发出 `native-authorization/changed(state)`。Desktop 订阅此中性事件，不依赖具体业务身份服务。

提供者负责凭据存储、会话验证、尝试代际、过期与取消。`getState`、`poll`、`cancel` 及成功的 `complete` 只返回不含令牌的显示状态。`start` 的私有导航数据仅交给 Desktop Host/Main 桥接。回调 URL 和授权码不会经过应用渲染进程 IPC。取消必须等待其拥有的工作结束，并阻止迟到结果恢复已撤销的凭据。

<a id="understand-the-implementation"></a>

## 理解实现

Desktop 消费者负责沙箱临时浏览器、发送者验证、导航策略及资源清理。此包不提供 Remote 方法，也不依赖 Electron。

<a id="further-exploration"></a>

## 进一步探索

- [Desktop](../../../apps/desktop/README.zh.md)
- [企业身份](../uwork-enterprise/README.zh.md)
- [授权拥有者决策](../../../.agents/notes/implemented/architecture/2026-11-10-native-product-authorization.zh.md)

<a id="model-experience"></a>

## 模型体验

无，因为此服务仅将原生授权界面连接到产品身份提供者，不增加模型输入或工具。

#### KV 缓存影响

此服务不改变提示词、模型请求、消息顺序或缓存键。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 注册表不实现身份协议或凭据事务。提供者必须拒绝取消后的迟到结果。
- 真实员工授权及 Windows x64/Mac ARM 原生验收需要相应设备和服务。

<a id="dev-note"></a>

### 开发备注

针对性注册表测试检查无所选提供者、重复拒绝及生命周期撤销。Desktop 负责真实浏览器生命周期证据。

Desktop profile 测试提供选择启用的公开企微空流程探针：设置 `DSH_WECOM_LIVE=1`，在有桌面显示及构建产物的环境中通过 `vitest.e2e.config.ts` 运行 `apps/desktop/tests/uwork-profile.e2e.ts`。若环境需要代理，使用 `DSH_WECOM_PROXY` 显式传入其 URL；共享测试设置会清除环境中的代理变量。探针启动真实 Host handoff，打开生产隔离 Electron 载体，将安全页面证据放在 `.artifacts/wecom-live`，随后取消，不扫码或认证。它使用临时 profile 根目录，保留证书校验与沙箱。仅 handoff 成功不能证明二维码可用：登录服务网络失败仍视为 live 探针失败。

2026-11-10 的 Linux live 探针仅构成部分证据：真实北京 Host handoff 启动成功（HTTP 201），但生产载体连接 `login.work.weixin.qq.com` 时发生 `ERR_TUNNEL_CONNECTION_FAILED`，独立 Node 网络请求也复现失败。二维码未渲染。载体销毁、Host 取消及 signed-out 状态断言已完成，未发生认证。此选择启用的网络失败与通过的默认离线 profile 回归分开记录。
