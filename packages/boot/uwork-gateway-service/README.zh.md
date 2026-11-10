---
description: '安全的企业账户与用量投影'
kind: "package-reference"
---

# @deepseek-ai/dsh-uwork-gateway-service

[English](README.md) | 中文

## 概述

安全读取企业网关账户与用量的 Host 服务参考。在 `uworkIdentity` 之后挂载；`ctx.uworkGateway` 通过 Remote 方法提供脱敏概览和经过验证的统计。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与待办事项](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

配置控制面 `apiBaseUrl`、精确部署白名单 `allowedModelEndpointOrigins`、请求 `timeoutMs`、`maxResponseBytes`、`maxItems` 与成功读取缓存时长 `cacheTtlMs`。请求在身份服务按代次隔离的 Host 回调内执行。概览包含公网端点、脱敏密钥元数据、订阅与明确的授权模型限制；既不显示也不生成密钥。

用量缓存按组织、用户、代次、周期和指标隔离。身份变化清除缓存。新用量筛选会取消旧筛选。刷新失败时，过期读取可保留同身份、同筛选的 `lastSuccess` 及观察时间。未登录状态不发送请求，也不包含统计数值。错误不会变成虚构的零。

<a id="understand-the-implementation"></a>
## 理解实现

网关读取失败也经过身份回调返回，确保在显示上次成功值前完成最终代次检查。身份通知使缓存失效并取消过期工作。

<a id="model-experience"></a>
## 模型体验

无，此包不增加工具、模型消息或会话内容。

#### KV 缓存影响

此包不改变模型请求前缀。

## 已知限制与待办事项

<a id="known-limitations-and-deferred-work"></a>

- 认证响应示例均为合成数据。已观察协议没有指定用量费用与订阅额度单位，因此这些单位仍标为未指定。成功结果仅存内存，服务释放后清除。
### 开发备注

测试将真实身份服务和文件凭据服务与合成的外部发行方及网关组合使用。Loader 用例验证通过配置激活服务。
