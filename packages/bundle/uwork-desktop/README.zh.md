---
description: "UWork 桌面 profile 的品牌与公开公司技能目录。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-uwork-desktop

[English](README.md) | 中文

## 概述

为 dsh Web 界面加入 UWork 侧栏、首页品牌和 PUBLIC 公司技能目录，关闭默认鲸鱼品牌层。此 bundle 必须排在基础与 Web bundle 之后；此 fork 的 Desktop 产品配置将该层纳入初始化、打包和恢复。

## 目录

- [使用此包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

本地 profile 必须能解析该 bundle 及其依赖。按以下顺序配置 profile 的 package.json：
```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@deepseek-ai/dsh-uwork-desktop"
      ]
    }
  }
}
```

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现内部说明</summary>

补丁关闭 ui-brand-official 行，再加入 ui-uwork、匿名公司目录 Host 及其插件标签页。目录来源配置在 Host 行，浏览不需要企业身份。其余模型、会话、权限和工作台贡献沿用前面各层；后续 profile 补丁仍能覆盖这些行。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [Profiles](../../boot/app-boot/README.zh.md)
- [UWork](../../client/ui-uwork/README.zh.md)
- [公司目录](../../boot/uwork-company-market/README.zh.md)
- [Web](../web-app/README.zh.md)

<a id="model-experience"></a>
## 模型体验

无；品牌呈现和只读目录浏览不添加模型输入。

#### KV Cache effect

无。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 企业身份和网关用量尚未装配；公司技能安装与启用仍待完成。
- Windows x64 和 Mac ARM 签名安装包及原生验收尚待完成。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
