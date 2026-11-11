# Mac ARM 本地 Preview 验收

## 范围与环境

按用户 2026-11-11 的要求，先验证 Mac ARM；Windows x64 后续执行。Office 编辑不在本次范围，任务模式沿用 dsh 原生 Agent 预设。此记录区分源码测试、本地安装包、原生界面和真实企业服务。

本机为 macOS 27.2 arm64，构建使用 Node 25.9.0、pnpm 11.28.5；应用版本为 0.2.2-rc.1，产品为 UWork Next Preview。默认 home 为 `~/.uwork/harness-preview`，安装身份为 `io.github.jas0nxlee.uwork.next`。系统没有有效代码签名身份，本次使用本地 ad hoc 模式，不计入 Developer ID 签名、公证或正式升级验收。

## 检查结果

| 检查项 | 结果 | 证据与限制 |
|---|---|---|
| 冻结依赖安装 | 通过 | `install --frozen-lockfile`，未改写锁文件 |
| 构建与类型 | 通过 | `build:artifacts` 八项及其后的 `build:check` 两项通过；打包流程的完整 local 构建十项通过 |
| Mac 临时路径兼容 | 通过 | Desktop profile 测试使用 `realpathSync` 规范化分配的临时根，保留精确路径和旧数据哨兵断言 |
| `.uwork` 隔离、CLI 与恢复 | 通过 | 构建后的 Host、捆绑 CLI、恢复与再次启动；中文及空格路径中旧根哨兵的 SHA-256、mtime 不变 |
| 原生授权载体 | 通过 | 实际 Electron 中模拟 HTTPS 签发方，验证无 Node 的 sandbox guest、私有回调、取消、过期及所有者释放；未使用员工身份 |
| 企业与市场业务逻辑 | 通过 | 六个所属包的十一份测试文件，共 339 项通过，覆盖身份、模型配置、网关、公司技能目录及安装管理 |
| 本地发行身份 | 通过 | 修复 unsigned 环境覆盖产品 app ID；四份打包测试共 138 项通过，Mac builder 测试还核对最终 app ID 及嵌入的产品元数据 |
| ASAR 成品检查 | 通过 | 新增回归所在文件三项通过；完整 ASAR 字节与权限校验后，使用同一已验证准备目录的 profile 元数据，实际调用 `.app` 内 CLI、Host 和原生资源通过 |
| Mac ARM DMG | 分阶段通过 | 已生成 DMG，`hdiutil verify` 通过；原打包命令因旧 ASAR 检查脚本失败，修复后单独重跑成品检查并通过，未将原运行记录改写为成功 |
| 本地 ad hoc 签名 | 通过 | 对解包应用和从 DMG 安装的应用分别执行 `codesign --verify --deep --strict`，均通过；主可执行文件为 Mach-O arm64，Info.plist 中 app ID 和版本正确 |
| 从 DMG 安装 | 通过 | 只读挂载 DMG，复制到此前不存在的 `/Applications/UWork Next Preview.app`，没有覆盖旧 UWork；安装包和 SHA-256 清单另存桌面 |
| 首次启动进程与 home | 通过 | 已安装应用的 Main、Host 和 Renderer 进程持续运行，Host loopback 连接存在，独立 home 和 Electron userData 已创建；此结果不代表页面视觉或交互通过 |
| 原生界面、输入及退出 | 未验收 | 多次按完整安装路径读取应用界面均超时，重置自动化会话后仍复现；Finder 同一工具读取正常，不能仅凭进程存在认定界面通过 |
| 真实企微、模型与账单 | 未验收 | 模拟签发方和匿名公司市场不能替代员工扫码、真实模型调用及用量对账 |
| Developer ID、公证和升级 | 未验收 | 本机无签名身份；本地 unsigned 包没有发行更新源、正式升级资格或已签名 Computer Use helper |

日志位于 `/tmp/uwork-mac-*-20261111.log`；隔离打包工作树为 `/Users/ljp/.cache/uwork-mac-arm-package-20261111`，其中 `apps/desktop/.desktop-build/packaging-runs/` 保留完整阶段记录。这些本机证据未上传，正式发布条件继续由 [执行清单](todo.md) 的 T37–T40 跟踪。

## 交付产物

桌面目录为 `/Users/ljp/Desktop/UWork-Mac-ARM-Preview-20261111`，包含 `uwork-next-0.2.2-rc.1-mac-arm64-unsigned.dmg` 和 `SHA256SUMS`。DMG 的 SHA-256 为 `2f87aa298d556651902d1f8ce74c25a97f717fe5ee9e55c9876abd56415d7e85`；该摘要是产物内容校验值，不是代码签名。

本地包不包含正式更新 feed、ZIP、发行完成记录或已签名 Computer Use helper。真实企微扫码、模型调用、用量对账、原生界面矩阵和连续版本升级均继续保留未验收状态。

## 打包缺陷与修复

首次实际打包在准备阶段的 CLI 插件安装检查失败：临时 runtime 的父目录缺少应用清单。准备流程现将真实应用清单放在 `dsh` 旁，与最终 `app.asar` 中的 CLI 读取位置一致；修复后的准备检查已验证离线插件安装/移除、Host 和原生资源。

本地 unsigned 环境现保留应用清单声明的产品 ID，忽略继承的发行 ID；未定制应用继续使用上游默认 ID。回归用例修改前复现错误 ID，修改后通过，并校验最终 builder 元数据。

本机文件同步系统会给生成的嵌套 `.app` 附加 FinderInfo，实际 `codesign` 报告 resource fork/Finder information 并停止。清理后系统仍立即重新附加；这一清理方案已撤回，没有放入最终代码。改用同步目录之外的隔离工作树构建，保留全部签名检查和安全属性，原检出不移动。

成品检查原先直接用普通 Node 的文件 API 读取 `app.asar/dsh/package.json`，报 ENOTDIR。现先校验完整 ASAR 内容与准备清单一致，再从该已验证准备目录读取 profile layers；运行路径仍指向真实 `.app` 内的 ASAR，未解包替代执行或跳过原生检查。修复后的成品检查已通过，原失败记录保留。

## 企业模型修复复验：0.2.2-rc.1.20261111.3

| 检查项 | 结果 |
|---|---|
| 本地 Mac ARM DMG | 完整打包流程、成品运行时、`hdiutil verify`、安装后的 arm64 可执行文件和 `codesign --verify --deep --strict` 均通过。 |
| 已有企微登录恢复 | 启动最终安装版并复用现有企业微信登录。模型选择器自动显示 6 个已授权模型，默认选中 `ucas-deepseek-flash`。 |
| 同会话真实模型调用 | 第一轮使用 `ucas-deepseek-flash`，收到 `UWORK-MAC-ARM-OK`；在同一会话切换至 `ucas-gpt-mini`，收到 `UWORK-MODEL-SWITCH-OK`。本地会话日志的两条请求头分别记录对应模型，两轮均为 `completed`。 |
| 模型配置与发送回归 | 9 个测试文件共 289 项通过；两项定向浏览器回归通过，覆盖无模型保留草稿、模型自动配置、手动选择和两次回复。 |

本次从 DMG 更新了本机预览应用，保留原有应用备份和企业登录数据。交付目录为 `/Users/ljp/Desktop/UWork-Mac-ARM-Model-Fix-20261111`，DMG 的 SHA-256 为 `e33149fed7d17345a10ea6b15036acd79051e041ee0c0d1bf4ce7b78901c126c`。本次未重新扫码，未验收换账号、用量对账、正式签名、公证或 Windows。

## UCAS 能力修复复验：0.2.2-rc.1.20261111.4

按源 UWork 的 UCAS 目录 revision 35，以插件配置逐模型补齐上下文、文本/图片输入、推理档位和请求方言；不再对六个模型统一套用纯文本 32K 配置。32,768 token 保留为单次输出预算。六个已保存模型的能力与源目录逐项匹配；未对百万 token 满窗口做压力测试。

最终安装版在同一会话完成 ucas-deepseek-flash / High 图片识别（返回 7319）和 ucas-gpt-mini / Xhigh 文本回复（返回 UCAS-CAPABILITIES-OK）。请求头记录对应模型与推理强度，两轮均 completed，tool/call 为零。117 项所属包测试、企业浏览器回归、最新源码构建及其后 build:check、完整打包、43 项文档检查和定向 lint 通过。

交付目录仍为 /Users/ljp/Desktop/UWork-Mac-ARM-Model-Fix-20261111，包含 .4 DMG、SHA256SUMS、model-capabilities.json、native-acceptance.json 和验收说明。DMG SHA-256：77c4e9082ed990ee6b4060f9d43a28c44da361b1ea70c16ad13f926dbf19678c。本地 ad hoc 预览版，无 Developer ID 签名或公证，Windows 仍未验收。

## 企业托管提供商复验（0.2.2-rc.1.20261111.6）

UCAS 提供商在原生模型设置页显示“企业托管”，编辑和删除入口已移除。Host 设置写入在持久化前校验所属插件权限，覆盖直接修改、删除以及替换父级。UWork 组合停用内置 DeepSeek API Key 和账号提供商，并为已移除提供商的旧默认选择配置授权模型迁移。

本机安装 .6 后检查设置页，确认企业托管标记、操作入口移除和默认 DeepSeek 卡片移除。使用 ucas-deepseek-flash 新建会话返回 UCAS-MANAGED-OK，持久会话记录 completed。安装在原后台任务已停止后执行。

147 项 Host 测试、184 项 Client/设置 API 测试和企业浏览器回归通过。另修复双窗口并发读取空身份时停留在 restoring 的问题，有修改前失败和修改后通过的定向回归。最新源码构建、随后 build:check、43 项文档检查、定向 lint、DMG 完整性及安装后签名结构均通过。交付目录中的验收说明和 native-acceptance.json 记录本版结果。

## 企业用量名称复验（0.2.2-rc.1.20261111.7）

本机安装 .7 后，企业用量页显示已验证的用户姓名和配置的组织名称，不再显示原始账户 UUID，网关用量加载正常。31 项定向测试及企业浏览器回归通过；账号切换时拒绝不匹配身份的结果。最新源码构建、其后的 build:check、43 项文档检查、DMG 完整性及安装后签名结构均通过。本次没有重新发送真实对话，沿用 .6 的模型验收记录。
