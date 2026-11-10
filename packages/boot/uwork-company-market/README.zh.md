---
description: "公开公司技能、校验安装及原生发现"
kind: "package-reference"
---

# @deepseek-ai/dsh-uwork-company-market

[English](README.md) | 中文

## 概述

读取 [UWork 桌面 bundle](../../bundle/uwork-desktop/README.zh.md)选择的 PUBLIC SkillHub 目录。无需企业登录；浏览目录不会安装或执行技能；显式安装会激活校验后的内容，供原生技能发现使用。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

将 `baseUrl` 配置为 SkillHub 部署根地址。除回环 HTTP 部署外必须使用 HTTPS。服务提供 `uworkCompanyMarket/search` Remote，参数为搜索文本、从零开始的结果页码及协作取消信号。空文本列出所有技能，否则按标题、规范 slug 或摘要做不区分大小写的子串搜索。返回页包含来源、匹配总数及下一页或 null。全局 `global--slug` 别名返回为裸 slug，使目录与持久安装记录使用同一身份。

`installations`、`installSkill`、`setEnabled` 和 `uninstallSkill` 只管理该来源的内容。默认存储目录是 `<profile.dir>/company-skills`，可用绝对路径 `installDir` 覆盖。两者均不存在时仅提供目录浏览。停用保留安装内容；卸载删除激活记录，恢复流程清理自有版本。不触碰个人技能或 npm 插件。

[UWork bundle](../../bundle/uwork-desktop/cordis.patch.yml)提供以下挂载配置：

```yaml
- id: uwork-company-market
  name: '@deepseek-ai/dsh-uwork-company-market'
  config:
    baseUrl: https://aihub.ucas.com.cn/skillhub
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `baseUrl` | 必填 | 公开 SkillHub 部署根地址。 |
| `installDir` | `<profile.dir>/company-skills`；没有 profile 时仅提供目录浏览 | 公司市场自有内容存储的绝对路径。 |

[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-uwork-company-market)列出完整的传输、解压、存储及观察限制。

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现内部细节——点击展开</summary>

服务读取 `/.well-known/clawhub.json`，核对声明的 API 同源，再按数字 `nextCursor` 完整取页后搜索。重定向、URL 凭据、重复游标、重复技能、无效 JSON 和不完整目录均被拒绝。每次搜索重新读取目录，不发送授权头。服务卸载会取消并等待活动读取。超出配置限制会明确报错，不截断结果。

安装会发现并解析准确的 namespace、slug 和版本，仅允许对应的同源下载路径，将有界 ZIP 流写入私有暂存目录。解压拒绝路径穿越、链接、跨平台名称冲突、缺少根 `SKILL.md`、无效原生技能元数据或空指令、条目超限及复合 SHA-256 指纹不符。解压文件仅保留所有者权限，包括归档声明的执行位；移除组、其他用户及特殊权限。跨进程锁串行安装和管理操作；完整不可变版本先进入 `versions`，再原子替换索引以激活，但不承诺断电持久性。技能读取通过原子索引快照访问，不等待更新下载；旧的已提交版本保留至卸载，供运行中的任务使用。激活失败保留旧指针；写入确认丢失时重新读取，若结果不可读则保留候选并报告 `unknown`，不删除可能已提交的内容。无效持久状态会阻止管理操作，不会当作空安装列表。

存在 `skills` 服务时，注册期 provider 复用原生文件系统解析器，仅扫描已启用版本根目录；个人文件系统技能同名时优先。管理成功立即刷新发现，其他进程的索引变更在 `installationWatchMs` 周期内检测。压缩、解压、条目、文件、路径、记录、安装数和保留版本数均受配置限制，超限拒绝完整操作，不静默裁剪。达到保留版本限制后，须卸载自有技能才能继续安装新版本。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [公司市场界面](../../client/ui-uwork-company-market/README.zh.md)
- [Profile 管理](../../../docs/subsystems/boot.zh.md)
- [协议基线](../../../tasks/protocol-baseline.md)

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tool-skill` 间接影响：已启用安装技能的名称和摘要进入技能目录，选中的指令正文及资源目录说明进入保留的工具历史。浏览目录和安装元数据不增加模型输入。

#### KV Cache effect

安装、启停和卸载使技能发现失效，原生消费者可追加替换目录，不改写已有工具结果。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 安装校验发布内容完整性，不保证执行安全；执行继续使用原生工具权限和审批。
- 历史已提交版本占用配置预算直到卸载；不支持自动淘汰。
- 不支持私有目录和企业凭据。
- 每次查询在配置限制内读取完整目录；没有持久化缓存。

<a id="dev-note"></a>
### 开发备注

公开公司技能目录保留部署方的所有权；本服务不存储员工身份、token 或 API Key。
