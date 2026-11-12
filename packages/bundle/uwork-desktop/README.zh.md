---
description: "UWork 桌面 profile 的品牌、企业身份、托管模型路由、用量与公开公司技能。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-uwork-desktop

[English](README.md) | 中文

## 概述

在原生 dsh 界面上组合 UWork 展示、原生企业登录、托管模型路由、企业账号与用量及经过校验的 PUBLIC 公司技能，并关闭默认鲸鱼品牌层。此 bundle 必须排在基础与 Web bundle 之后；此 fork 的 Desktop 产品配置将该层纳入初始化、打包和恢复。

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

补丁关闭 ui-brand-official，加入 UWork 品牌、匿名公司目录及其插件标签页。目录浏览与安装不需要企业身份；已启用安装通过原生技能 provider 提供。原生授权与企业身份负责登录及仅 Host 持有的凭据。网关服务通过 Host 协议客户端提供安全账号与用量投影。托管配置通过原生 llm-pi-ai 安装显式企业路由，保留个人 provider 与默认模型。发行配置按 UWork 目录逐模型声明上下文窗口、文本/图片输入和推理等级；单次请求输出预算为 32,768 个 token，与模型公布的最大输出容量分开。GPT 和 GLM 的上下文为 1,000,000 个 token，DeepSeek 和 Kimi 为 1,048,576 个。GLM 仅接收文本，另外五个已配置模型也接收图片。GPT 提供 low、medium、high、xhigh 和 max，其余提供 low、high 和 max。GLM 和 DeepSeek 同时发送 `thinking.type: enabled` 与 `reasoning_effort`，GPT 和 Kimi 发送 `reasoning_effort`。默认模型为空时选择首个有授权的偏好模型。企业账号及用量 UI 展示安全投影；会话、权限和工作台仍由前面各层负责。对话、交互及工作台展示通过原生 owner 扩展点接入，不复制会话、composer 决策或 pane 状态。后续 profile 补丁仍可覆盖这些行。 UWork 组合停用内置 DeepSeek API Key 和账号提供商、对应的账号设置界面及依赖它的账号通知。模型设置中的托管提供商为只读，企业同步负责更新。

企业组织与回调 allowlist 来自公开 UWork 发行配置，不含会话 token 或模型 key。真实认证后的能力验证与正式桌面验收仍独立于此组合。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [Profiles](../../boot/app-boot/README.zh.md)
- [UWork](../../client/ui-uwork/README.zh.md)
- [企业身份](../../credentials/uwork-enterprise/README.zh.md)
- [原生授权](../../credentials/native-authorization/README.zh.md)
- [网关服务](../../boot/uwork-gateway-service/README.zh.md)
- [托管模型配置](../../llm/uwork-model-provisioning/README.zh.md)
- [对话展示](../../client/ui-uwork-conversation/README.zh.md)
- [原生交互展示](../../client/ui-uwork-interactions/README.zh.md)
- [原生工作台展示](../../client/ui-uwork-workbench/README.zh.md)
- [企业账号 UI](../../client/ui-uwork-enterprise/README.zh.md)
- [企业用量 UI](../../client/ui-uwork-usage/README.zh.md)
- [公司目录](../../boot/uwork-company-market/README.zh.md)
- [Web](../web-app/README.zh.md)

<a id="model-experience"></a>
## 模型体验

通过 `dsh-tool-skill` 渲染的已启用公司技能及原生 `llm-pi-ai` 渲染的托管企业选择间接影响；品牌、登录、账号展示及用量读取不添加模型输入。

#### KV Cache effect

公司技能启用状态变化可在后续模型请求中追加替换技能目录。配置过程不重写会话选择或现有请求前缀；实际模型请求由后续选择与适配器行为负责。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 缺少已认证测试身份时，真实员工登录、授权网关推理、账号切换及用量记账仍未验证。公开发现与合成 fixture 不能替代这些证据。
- Windows x64 和 Mac ARM 签名安装包及原生验收尚待完成。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
