---
description: "公开公司技能目录与浏览"
kind: "package-reference"
---

# @deepseek-ai/dsh-uwork-company-market

[English](README.md) | 中文

## 概述

读取 [UWork 桌面 bundle](../../bundle/uwork-desktop/README.zh.md)选择的 PUBLIC SkillHub 目录。无需企业登录；浏览目录不会安装或执行技能。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

将 `baseUrl` 配置为 SkillHub 部署根地址。除回环 HTTP 部署外必须使用 HTTPS。服务提供 `uworkCompanyMarket/search` Remote，参数为搜索文本、从零开始的结果页码及协作取消信号。空文本列出所有技能，否则按标题、规范 slug 或摘要做不区分大小写的子串搜索。返回页包含来源、匹配总数及下一页或 null。

<a id="understand-the-implementation"></a>
## 实现说明

服务读取 `/.well-known/clawhub.json`，核对声明的 API 同源，再按数字 `nextCursor` 完整取页后搜索。重定向、URL 凭据、重复游标、重复技能、无效 JSON 和不完整目录均被拒绝。每次搜索重新读取目录，不发送授权头。服务卸载会取消并等待活动读取。配置默认值为完整搜索时限 `timeoutMs=30000`、每响应字节限制 `maxResponseBytes=1048576`、`upstreamPageSize=50`、`maxPages=100`、`maxItems=5000`、`resultPageSize=50` 和 `maxQueryLength=512`。超限明确报错，不截断结果。

<a id="further-exploration"></a>
## 延伸阅读

- [公司市场界面](../../client/ui-uwork-company-market/README.zh.md)
- [Profile 管理](../../../docs/subsystems/boot.zh.md)
- [协议基线](../../../tasks/protocol-baseline.md)

<a id="model-experience"></a>
## 模型体验

无，目录读取不增加模型输入。

#### KV Cache effect

无。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 安装、更新、启用和删除由独立技能内容事务负责，不走 npm bundle 安装。
- 不支持私有目录和企业凭据。
- 每次查询在配置限制内读取完整目录；没有持久化缓存。

<a id="dev-note"></a>
### 开发备注

公开公司技能目录保留部署方的所有权；本服务不存储员工身份、token 或 API Key。
