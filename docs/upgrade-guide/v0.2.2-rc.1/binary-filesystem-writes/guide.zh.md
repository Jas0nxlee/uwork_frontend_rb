---
kind: upgrade-guide
description: "FileSystem 提供方必须通过 writeBytes 实现有写入意图保护的原始字节发布。"
---

# 二进制文件系统发布

[English](guide.md) | 中文

## 变更

`FileSystem` 现在要求实现 `writeBytes(target, content, expected, signal?, sandboxPolicy?)`，返回 `FsBinaryWriteOutcome`。继承 `FileSystem` 的第三方提供方必须实现新方法。本地、沙箱和 SSH 提供方已同步更新。已有文本方法和 Session 格式不变。

二进制写入必须指定 `createIfAbsent` 或 `replaceIfVersion`；返回操作与版本，不包含文本 diff 字段。本地写入对字节取快照，并在原子发布前重新核对版本。沙箱提供方执行逐次策略，SSH 校验 Base64 和 8 MiB 传输限制。

## 迁移

1. 在各自定义文件系统提供方中实现 `writeBytes`，使用 `Uint8Array` 内容和必填的 `FsWriteIntent`。
2. 保留目标解析、沙箱检查、取消、原子发布和陈旧版本错误。不要将二进制内容解码为 UTF-8，也不要静默执行无版本保护的替换。
3. 更新提供方夹具和消费方。后续保存使用返回版本；版本陈旧时必须保留已有文件。
4. 对实际提供方验证非 UTF-8 往返、新建冲突、陈旧替换、保存取消和只读拒绝。
