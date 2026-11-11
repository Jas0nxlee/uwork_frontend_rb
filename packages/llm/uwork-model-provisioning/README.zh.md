---
description: "仅 Host 的受管企业模型路由与崩溃恢复。"
kind: "package-reference"
---

# @deepseek-ai/dsh-uwork-model-provisioning

[English](README.md) | 中文

## 概述

此 Host 服务通过原生 `llm-pi-ai` 配置显式授权模型路由。设置保存代次专属凭据引用；凭据提供方保存密钥和专属恢复日志。个人 provider 与个人默认模型保留。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

在 `credentials`、`settings`、`agentDefaultModel` 和原生 `llm-pi-ai` 之后挂载。`settingsNamespace` 默认为 `llm-pi-ai`。Host 身份回调调用 `uworkModelProvisioning.provision(input)`，传入组织、用户、代次、操作与可选的身份生命周期 signal、候选路由和新凭据引用、公网 HTTPS 推理端点、API key、授权模型 id、已验证能力和模型偏好顺序。不得通过 Renderer 方法暴露此输入。配置 `gatewayApiBaseUrl` 和显式 `allowedModelEndpointOrigins` 后，身份认证变更会自动刷新授权。可选 `modelCatalog` 为缺少能力信息的端点按模型声明上下文窗口、文本/图片输入、请求输出预算、推理等级和 thinking 方言。`legacyTextCatalog` 仍可用于统一的纯文本部署。模型仍须同时在 Key 可见目录和账号授权中，服务端显式能力优先。安全 Remote 方法 `getState`、`refresh` 和 `createManagedKey` 仅返回状态。只有显式 `createManagedKey(expectedBinding, signal)` 动作能为确认时保存的精确组织、用户和代次创建密钥；按账号持久化的 intent 会在结果未知后阻止重复 POST，直到新密钥列表按别名确认结果。 托管提供商子树通过 Settings 保留给本插件更新。`retiredDefaultProviders` 指定产品已移除的提供商，其已保存默认选择会改为有授权的偏好模型。

<a id="understand-the-implementation"></a>
## 理解实现

事务先写暂存日志，再保存密钥、执行设置版本检查，最后将日志标为已提交才接收请求。提交失败时仅移除匹配的自有路由和密钥。补偿失败会保留日志，供 `recover()` 恢复。启动恢复不会将已存凭据视为当前授权。日志更新在凭据提供方的记录锁内比较预期自有凭据引用。

在访问凭据前拒绝受管原生发现；授权能力刷新经由网关。`uwork-` 路由前缀保留给此所有者。原生 request-signal hook 在解析凭据前拒绝失效的受管路由。身份 signal 撤销会取消在途推理；关闭设置页不会撤销已提交的路由。显式授权 id（或服务端明确授予无限制权限时的已验证目录）与已验证能力声明取交集；显式模型列表阻止发现操作扩大授权。刷新同一账号时保留提供方 ID 和仍有授权的默认选择，并替换凭据引用。默认为空或同一账号的默认模型撤权时，采用首个有授权的偏好模型。保留个人默认与 Session 选择。

<a id="model-experience"></a>
## 模型体验

通过原生 pi-ai 请求及 Agent 使用的模型选择间接影响模型。

#### KV 缓存影响

授权变更不改写 Session 历史或其请求前缀。原生适配器与后续模型选择拥有实际请求。

## 已知限制与延后工作
<a id="known-limitations-and-deferred-work"></a>

- 调用方提供显式的端点或发行配置；模型名称不能证明图像或推理支持。
- 仍需真实认证网关能力与推理验证。
- 本包不声明货币，也不从 token 推算消费。
- 已修改而不再匹配日志的路由保留供检查，自有密钥则移除。

### 开发备注

包内事务测试覆盖补偿、版本冲突、重启、个人默认、授权交集和取消。Loader 组合测试使用真实 profile 持久化、credentials-local、settings、agent-default-model 与 pi-ai。
