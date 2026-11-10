---
description: '企业网关协议与有界 Host 请求层'
kind: "package-reference"
---

# @deepseek-ai/dsh-uwork-gateway

[English](README.md) | 中文

## 概述

仅供 Host 使用的企业网关协议参考。在 `uworkIdentity.withSession` 内创建客户端；身份服务会在返回前检查代次。客户端不缓存数据，也不刷新身份凭据。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与待办事项](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

调用方显式提供 `apiBaseUrl`、精确部署白名单 `allowedModelEndpointOrigins`、`timeoutMs`、`maxResponseBytes` 和 `maxItems`。控制地址必须是配置的 HTTPS origin。DNS 名称格式并不证明公网路由；模型端点必须匹配部署 origin 白名单。请求拒绝重定向，身份 bearer 只发送到该 origin。响应字节与集合长度均有限制。取消、超时、认证、授权、限流、网络和数据格式失败分别报告。

用量保留服务器计费数值，并明确单位未指定；成功率转换为比例。缺失或失败的统计不会变成零。仅公开 `llm_base_url`，丢弃内部端点字段。

密钥明文仅能返回给 Host。生成操作只请求一次。网络错误、服务器失败和成功响应格式错误表示操作结果未知；调用方必须持久化意图，按别名核对结果后才能再次生成。

<a id="understand-the-implementation"></a>
## 理解实现

请求层限制流式响应字节与响应集合长度，隔离控制面和模型 API 的 bearer，并仅解析支持的协议字段。

<a id="model-experience"></a>
## 模型体验

无，此包不增加工具、模型消息或会话内容。

#### KV 缓存影响

此包不改变模型请求前缀。

## 已知限制与待办事项

<a id="known-limitations-and-deferred-work"></a>

- 由于没有员工测试身份，认证响应示例均为合成数据。此包不编排模型配置、不持久化密钥生成意图，也不向 Client 提供密钥明文。
### 开发备注

使用 Vitest 运行包内协议测试。上游刷新端点会轮换 bearer，因此身份刷新由身份服务负责。
