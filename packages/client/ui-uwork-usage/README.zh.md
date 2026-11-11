---
description: '企业用量与订阅展示'
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-uwork-usage

[English](README.md) | 中文

## 概述

只读企业用量面板，提供周期与指标筛选、请求与 Token 总量、成功率、每日汇总、模型分布、订阅额度、组织名称、用户姓名、公网网关端点和脱敏密钥元数据。与安全的 Host 网关服务及标准 Client 资源服务一起挂载。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与待办事项](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

侧栏入口打开原生主面板。统计数据通过 `useResource` 读取；身份变化先撤下原账号数据，再读取新范围。未登录状态显示登录提示，不虚构零值。刷新失败时显示提示，并在 Host 能确认身份时提供明确标注时间的同筛选上次成功结果。额度保留未指定计费单位，不添加货币符号。

面板支持全部八种应用语言、可用键盘操作的原生筛选与刷新操作。不提供凭据编辑或密钥明文查看。

<a id="understand-the-implementation"></a>
## 理解实现

标准资源注册表负责订阅。Remote 流监督器在连接中断时清除数据，并对下一 Host 代次重新订阅；面板本地状态仅保留筛选项。

<a id="model-experience"></a>
## 模型体验

无，此包仅展示现有的安全账户与统计投影。

#### KV 缓存影响

此包不改变模型请求前缀。

## 已知限制与待办事项

<a id="known-limitations-and-deferred-work"></a>

- 认证响应示例均为合成数据。趋势图展示已观察数值，并保留无障碍数据表格。上游协议提供单位前，计费单位与模型占比单位保持未指定。
### 开发备注

Host 身份流负责资源失效；Client 不轮询，也不在并行状态仓库中保留账户数据。
