---
description: "Office 编辑文件服务，供部署者配置完整快照、版本保护保存与会话写策略。"
kind: "package-reference"
---

# @deepseek-ai/dsh-uwork-office-storage

[English](README.md) | 中文

## 概述

通过组合的文件系统读取完整 DOCX、XLSX、PPTX 快照，并执行带版本保护的二进制保存。此可选 Host 插件注册 `ctx.uworkOfficeStorage`；编辑器消费者负责格式校验及编辑状态。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

在配置层中与 `fs`、`sandboxPolicy` 一起组合此插件。Remote 调用使用已授权的活动 `session` 查询；暴露端点时须提供 Session 服务及 Typert 注册表。读写接受会话工作区内的相对路径或绝对路径，扩展名为 `.docx`、`.xlsx` 或 `.pptx`，不区分大小写。拒绝末级符号链接与非普通文件目标。

| 配置 | 默认值 | 含义 |
|---|---|---|
| `maxDocumentBytes` | `8388608` | Base64 编码前的完整输入、输出字节上限，含边界值。 |
| `maxConcurrentOperations` | `8` | 接纳的读写操作数；超出返回 `busy`。 |

`capabilities(session, signal)` 报告文档上限及当前写入策略，不授予访问权。`stat(session, path, signal)` 只读普通文件元数据。`read(session, path, signal)` 返回完整原生字节，并核对读取前后的文件系统版本。`save(session, request, signal)` 接受带标准补位的规范 Base64 和显式 `createIfAbsent` 或 `replaceIfVersion` 意图。成功结果只对应已保存快照，不能清除之后的编辑改动。本插件拒绝工作区外目标及只读保存。其他写入检查由组合的文件系统提供者按 `sandboxPolicy.resolve({ session })` 执行。

[Office 编辑子系统](../../../docs/subsystems/uwork-office-editor.zh.md)包含生成的服务及结果参考。Client 消费者须挂载本包生成的 `/remote` 描述符；普通 `api/remotes` 装配不包含它。

<a id="understand-the-implementation"></a>
## 理解实现

操作接纳与取消由同一提供者生命周期负责。卸载时拒绝新操作，取消活动调用，并等待它们结束后再释放依赖。解码前检查编码长度，发布前检查解码后的字节长度。文件系统负责原子发布及版本冲突检测；本插件不增加直接磁盘写入路径。

<a id="further-exploration"></a>
## 延伸阅读

- [文件系统](../../fs/fs/README.zh.md) — 二进制发布及提供者保证。
- [沙箱策略](../../sandbox/sandbox-policy/README.zh.md) — 会话专属写入策略。

<a id="model-experience"></a>
## 模型体验

无，本包读写编辑器字节，不提供模型工具、消息或 Session 事件。

#### KV Cache 影响

无；文件操作不构造或修改模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 格式保真、备份恢复草稿、工作区外的原生另存为授权与未保存决策由编辑器消费者负责；二进制发布本身不校验 OOXML 压缩包。
- 响应中断可能导致无法确认是否已发布。重试前须重新读取并比较文档；不提供无条件重试或覆盖。文件系统版本规则及提供者对外部写入竞态的限制仍然适用。
- Remote 写请求使用 JSON/Base64，读取使用二进制结果附件。部署传输层须容纳编码后的请求大小；文件系统提供者可能有更严格的字节上限。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
