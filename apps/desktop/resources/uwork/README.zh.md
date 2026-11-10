# UWork 原生品牌资源

[English](README.md) | 中文

原样复制自 `Jas0nxlee/UWork_frontend` 的
`f6dda23d7e6f39aa66804933b60f893d38ab6914` 提交、`packages/desktop/build` 目录：

| 本目录 | 源文件 | SHA-256 |
| --- | --- | --- |
| icon.svg | uwork.svg | d39392cc3a71e453bc6af9d3b93af09e0e2b909333cce3d04c1a039e8fec27ec |
| icon.png | icon.png | 9819aa0c3b42795f070333d9db5865614b4b331a54d4549282c3f59e4780b9f8 |
| icon.ico | icon.ico | eac51bbf017034a23c1b661b7c1f3901935180bba0a76aca6abb79a53a3f111c |
| icon.icns | icon.icns | 2cadce8d5a13feb46f256c6ce219fee4d6db7e87fe9e3ab29d6eeed72af02978 |

`uwork-next` 发行使用 PNG 作为 Windows 可执行文件及“关于”图标，使用 ICO 作为 Windows 托盘图标，macOS 使用原生 ICNS。其他发行保留原资源。没有重新设计或改色。

这些资源只证明品牌来源，不代表完成代码签名、公证、安装、升级验收或获得发布授权。

## 发行验收

本地未签名候选在相应系统运行 `package:win:x64:unsigned` 或 `package:mac:arm64:unsigned`。产物带未签名后缀，不嵌入升级配置，不能作为正式发行证据。
签名 Preview 候选需要独立 HTTPS 测试域名及 32 位十六进制 release ID；feed 和二进制均使用 `uwork-next/<release-id>` 命名空间。禁止 production 部署与 DeepSeek 域名，不能替换 `dsh-latest` 网站安装包。上传授权仍需单独决定。

勾选 T36–T39 前必须保留真实 Windows x64、Mac ARM 主机的以下结果：

| 检查 | 所需证据 |
| --- | --- |
| Windows 签名 | 发布者、可信时间戳、全部内置可执行文件及 helper、NSIS 安装器 |
| macOS 签名 | Developer ID、hardened runtime、嵌套 helper、公证与 stapling |
| 安装 | 普通用户、不依赖外部 Node/pnpm、空格与中文路径、Applications 启动 |
| 企业闭环 | 真实员工登录、模型配置、切换账号与注销、公司技能、用量 |
| 升级 | 连续两个签名版本、独立 feed、离线及哈希/签名失败和重试 |
| 数据隔离 | 旧 UWork/dsh 目录不变；Host、CLI、子进程均使用 Preview home |

Linux 检查不能替代上述矩阵。原仓库 workflow 的 macOS ad hoc 签名不能替代 Developer ID 与公证。
