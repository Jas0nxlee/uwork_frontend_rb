# UWork Next

[English](README.md) | 中文

UWork Next 是面向企业用户的桌面 AI 工作空间。通过企业微信登录，在同一个应用中使用企业授权模型、公司技能，并查看网关用量。

## 功能

- **企业登录** — 使用企业微信扫码接入所属组织，自动配置已授权模型。
- **AI 对话** — 创建会话、添加文件，并结合工作区工具处理任务。具备相应能力的模型支持图片输入和推理强度调整。
- **模型管理** — 使用公司提供的 UCAS 模型，也可添加个人模型提供商。企业托管提供商的配置由应用维护。
- **公司市场** — 浏览、安装和管理组织发布的技能。
- **企业用量** — 按周期查看网关请求数、Token 用量、成功率和服务端提供的费用数据。
- **工作空间** — 管理会话与任务，结合文件预览和终端开展工作。

## 下载与安装

在 [GitHub Releases](https://github.com/Jas0nxlee/uwork_frontend_rb/releases) 下载适合当前系统的安装包。

| 平台 | 安装包 |
| --- | --- |
| Apple Silicon Mac | Mac ARM `.dmg` |
| Windows x64 | Windows `.exe` |

安装后的应用名称为 **UWork Next**。当前发布的是未签名预览版，具体版本的验证结果和安装说明请查看发布说明。

<a id="run"></a>

## 开始使用

1. 安装并打开 UWork Next。
2. 选择所属组织，使用企业微信登录。
3. 授权模型配置完成后，在对话输入区选择模型。
4. 创建会话并发送消息，按需添加文件或使用工作区工具。
5. 打开公司市场管理公司技能，或进入企业用量查看网关使用情况。

可用模型由组织授权决定。图片输入和推理选项取决于所选模型的能力。

## 本地数据

工作区配置和会话数据默认保存在当前用户目录下的 `.uwork` 中。迁移电脑时请先备份应用数据。

<a id="run-from-source"></a>

## 从源码构建

在本仓库中使用 Node.js 24.9 或更高版本，以及 pnpm 11.28.5。

```sh
pnpm install --frozen-lockfile
pnpm run build
```

桌面安装包构建步骤见[打包指南](apps/desktop/packaging/README.zh.md)。

## 反馈

通过[本项目 Issues](https://github.com/Jas0nxlee/uwork_frontend_rb/issues) 提交问题和功能建议。请附上应用版本、操作系统、复现步骤，以及已移除凭据和个人信息的相关日志。

## 许可证

[MIT](LICENSE)。第三方许可证声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
