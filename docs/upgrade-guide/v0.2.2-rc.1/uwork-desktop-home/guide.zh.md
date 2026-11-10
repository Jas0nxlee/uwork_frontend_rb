---
kind: upgrade-guide
description: "UWork 桌面发行使用独立的数据根、浏览器存储和外部 URL 协议。"
---

# UWork 桌面安装身份

[English](guide.md) | 中文

## 变更

此 fork 的桌面发行名为 UWork Next Preview。默认 Harness 数据根为 `~/.uwork/harness-preview`，替代 Desktop 隐式的 `~/.dsh` 默认值。捆绑 CLI 使用相同默认值。显式 `DSH_HOME` 仍优先。Electron 浏览器存储隔离在 `UWork Next Preview` 下，外部打开 URL 为 `uwork-next://open`。

已有 `.dsh`、旧 UWork 数据、浏览器会话和凭证不会自动复制。单独安装的 npm dsh 保留已有默认值。运行时包版本和 Session 格式不变。

## 迁移

1. 启动 UWork Next Preview，在独立 profile 中配置或登录模型提供方。评估期间保留已有应用和数据。
2. 如有意使用已有 dsh 数据根，在启动应用或捆绑 CLI 前显式设置 `DSH_HOME`。不兼容的运行时不要共用可写数据根。
3. 将桌面打开集成更新为 `uwork-next://open`。私有 Renderer 资源协议不变。
4. 确认新 profile 数据出现在 `.uwork/harness-preview/profiles/desktop` 下；保留旧目录，供后续显式导入。
