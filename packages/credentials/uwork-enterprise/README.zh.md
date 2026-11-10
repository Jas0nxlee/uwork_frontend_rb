---
description: "企业身份凭据与可取消的 Host 能力。"
kind: "package-reference"
---

# @deepseek-ai/dsh-uwork-enterprise

[English](README.md) | 中文

## 概述

`ctx.uworkIdentity` 独立于 DeepSeek 账户管理企业认证。它注册原生登录提供者和授权流程，保存不透明凭据 grant，并向 Host 网关调用方提供可取消的身份能力。它不修改个人模型设置，也不修改个人或公司技能。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

在本插件之前加载凭据提供者、授权服务和 native-authorization 服务。配置必须提供 `apiBaseUrl`、`organizations` 和 `defaultOrgId`；每个组织指定准确的 `orgId`、`corpId`、数字字符串 `agentId` 和 HTTPS `callbackUrl`，可选显示 `label`。API 地址必须是纯 HTTPS origin。回调地址不能包含用户凭据、查询参数或片段。未知字段、重复组织或未配置的默认组织会阻止启动。[公开部署数据](../../../tasks/fixtures/public-services/enterprise-identity.json) 不包含凭据。

`requestTimeoutMs`、`attemptTimeoutMs`、`pollIntervalMs`、`observationIntervalMs` 和 `maxResponseBytes` 分别限制发行方请求、登录尝试、轮询、跨进程撤销检测和完整 JSON 响应。默认值依次为 15 秒、5 分钟、1.5 秒、1 秒和 64 KiB。

Renderer Remote 方法为 `listOrganizations`、`getState`、`watchState` 和 `signOut`。`watchState(signal)` 发布当前安全状态及合并后的身份变化，并在订阅者取消或插件卸载时结束并移除监听器。`getState` 必须经发行方验证保存的 grant 后才能返回 `authenticated`；验证过程中其他调用方可以观察到 `restoring`。公开身份字段为组织 ID、用户 ID、显示名、过期时间和代际。认证错误使用 `uwork-enterprise/failed`，附带类型化原因和可选 HTTP 状态。诊断和公开投影不包含上游响应正文、回调 code、token 或 handoff secret。验证失败保持为失败，不会被静默解释为登录成功。

Desktop 通过私有 native-authorization 提供者发起登录、完成回调、轮询 handoff 和取消。Host 验证的尝试过期会保留为安全原生投影 `error: expired`，关闭尝试后仍可读取；开始新尝试、取消该过期尝试或退出会清除此状态。Host 调用方使用 `withSession(run, signal?)`，仅在 Host 内收到 token 和绑定身份代际的取消信号。不传调用方信号时，插件生命周期和身份撤销仍然生效。调用方必须响应信号，并避免在自己的公开输出中包含 token。该方法拒绝未登录访问，在使用前与返回前都通过凭据提供者记录锁内的只读 `modifyRecord` 操作读取持久化代际。周期观察使用同样的新鲜读取，因此缓存或文件观察延迟不会让已撤销的身份能力继续获得授权。

<a id="understand-the-implementation"></a>
## 理解实现

登录先撤销旧代际，再请求 handoff。HTTP 201 表示有效 handoff，HTTP 202 表示等待完成；仅 handoff start 的 404/405/501 允许使用不支持 handoff 的原生回调路径。网络故障、畸形响应、限流和 5xx 不会触发此回退。

发行方的 `state` 固定为配置中的组织 ID。随机尝试绑定通过准确配置的回调地址中的 `uwork_nonce` 传递。Main 回调接收器在单次提交 code 前验证 origin、路径、nonce、state、有效期、参数唯一性和 code 长度。登录和成功 claim 都必须经发行方 refresh 验证同一组织及用户。JWT 到期时间仅用于本地过期调度，不构成认证证据。

本服务仅通过凭据 grant API 写入 `uwork-enterprise/identity`。退出写入带新代际的持久化空 grant，阻止旧写入者恢复被撤销的会话。恢复期间，凭据锁覆盖服务端 token 轮换，使其他 Host 使用最新 token 刷新。本地切换和退出立即取消身份能力；定期观察检测其他进程的撤销或 token 轮换。取消和插件卸载会中止所属请求并等待其结束。状态通知在持久化或安全撤下后发布，并隔离监听器失败。通用 `native-authorization/changed` 事件向私有 Desktop 桥传递相同的不含凭据的原生提供者投影。

<a id="further-exploration"></a>
## 进一步探索

- [原生授权](../native-authorization/README.zh.md)
- [凭据](../credentials/README.zh.md)
- [授权](../authorization/README.zh.md)
- [协议基线](../../../tasks/protocol-baseline.md)

<a id="model-experience"></a>
## 模型体验

无，因为本插件仅管理 Host 认证，不贡献模型输入或工具。

#### KV Cache 影响

身份状态不改变提示词、保留消息或缓存键。网关及模型路由调用方负责由身份引发的请求变更。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办工作

- 跨进程取消在 `observationIntervalMs` 内被检测；本地请求取消无法撤销远端已经接受的副作用。
- 仅支持原生回调的发行方需要 Desktop 私有载体；通用授权流程仅在发行方支持 handoff 时才能自动完成。
- 凭据持久性与跨进程锁保证取决于所选择的凭据提供者。

### 开发备注

不要把历史 `.uwork` 凭据导入此 grant，也不要通过 Remote 暴露原生回调接收方法。部署白名单是公开配置；handoff secret 仅存在尝试内存中，token 仅存在凭据 grant 和 Host 身份能力中。
