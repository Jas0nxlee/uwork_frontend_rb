# UWork 迁移实施记录

## 当前进展

2026-11-10，`codex/uwork-desktop-migration` 已接通企业身份、原生扫码载体、受管模型、公司技能市场、企业用量和 UWork 展示层。源码及本环境可执行的 Linux/浏览器链路已有验证；真实员工联调、Windows x64/Mac ARM 签名安装与升级仍未完成。[执行清单](todo.md)区分已实现条目与未满足的发行条件。

发行元数据集中在 `apps/desktop/package.json` 的 `dshDesktopProduct`，由 Electron Main、捆绑 CLI、构建与产物脚本共同读取。默认产品名和 Electron 存储目录为 UWork Next Preview，home 为 `.uwork/harness-preview`，外部协议为 `uwork-next`，安装包前缀为 `uwork-next`。显式 DSH_HOME 优先，未声明发行元数据的普通 dsh 清单保持原行为。

打包、公证、产物 smoke、版本发现、上传计划、下载页和保留产物检查已改为读取集中名称。隔离的安装升级资格测试不继承日常产品存储身份。内部运行时版本和 Session 格式未变，旧 UWork 数据没有执行自动导入。 新增私有授权控制消息后，Desktop Host 生命周期协议从 4 升为 5；新 Main 明确拒绝旧缓存 Host，要求按当前发行重新准备 runtime，避免等待旧 Host 无法回答的请求。此协议升级不改写 Session 或个人配置。

## 前期底座检查

- Desktop 和 Desktop Host 最终全套：191 个文件通过、5 个文件跳过；2309 项测试通过、65 项跳过。测试包含平台模拟和本地测试服务，不代表真实签名或跨平台安装。
- 最终 build:artifacts（artifacts10）：8 项检查全部通过；build:check：2 项通过。
- test:docs：21 项通过；doc-sync：43 项通过。
- lint：已修复新代码的格式问题；完整检查仅报告一个未改动文件中的既有 unused-disable 警告。
- git diff --check：通过。

## 尚未完成

目前未满足的条件是：企微真实账号和授权模型/账单对账、签名 runtime 与两平台安装成品、两平台原生窗口/输入/权限复核、连续签名版本升级，以及正式产品版本/Publisher/部署 feed 的最终发行确认。这些条件不能由模拟响应、Linux Web 或原仓库 Mac ad hoc 签名替代。

已恢复公开的四组织配置并以真实 Host 成功创建北京 handoff（HTTP 201）。当前环境通过正常托管代理连接 `login.work.weixin.qq.com` 时发生 `ERR_TUNNEL_CONNECTION_FAILED`，未渲染二维码、未扫码或取得身份；载体与 Host 尝试均已清理。可重跑 opt-in 及脱敏证据见 `.artifacts/wecom-live/`。GitHub runner 元数据读取返回 403；本环境没有可用的员工或签名凭据绑定。公开配置不是凭据。

Office 编辑按用户最新要求延期。正式发布前仍须完成执行清单全部必交付项。

## Office 编辑延期

2026-11-10 按用户要求删除本轮新增的 Office Client 编辑器、Host 文件服务及独立 bundle，包括依赖、远程接线、配置、类型引用、文档和测试。为 Office 编辑单独新增且没有其他消费者的二进制写入和标签关闭守卫同步撤回。保留原有 dsh Office 只读预览与转换，以及桌面发行身份、启动路径和严格发行文件校验。Office 编辑不进入本次交付；既有只读预览与转换继续保留并纳入回归。

删除后检查：冻结锁文件安装通过；文件系统、SSH 和右侧栏共 49 个测试文件、763 项测试通过，4 项跳过；build:artifacts 八项及其后的 build:check 两项通过；构建产物启动两项通过；doc-sync 43 项通过。完整 lint 通过，保留未改动文件中的既有 unused-disable 警告。此次删除时，`packages/` 和 `apps/web/` 与迁移起点的源码差异已清零，当时仅保留桌面底座及相应方案文档的迁移改动。

## UWork 界面插件接入

空白首页新增独立的 `conversation.hero.brand.title` 插槽，和既有图标、背景插槽共同支持品牌呈现。没有占用者时仍显示原本的本地化标题；替换标题保留预览标记和常驻输入框。

Conversation 相关 55 个测试文件、904 项测试通过；build:artifacts 八项及其后的 build:check 两项通过；默认页面构建产物启动两项通过；doc-sync 43 项通过。此检查验证默认页面和标题扩展能力，不代表 UWork 全套 UI 或桌面发行已完成。

`client/ui-uwork` 和 `bundle/uwork-desktop` 通过侧栏、首页标题、图标和背景插槽显示 UWork/UCAS 资源，bundle 同时禁用默认品牌层。源资产保留 Apache-2.0 许可与来源记录，许可文件列入严格发行清单。真实 CLI 的临时 profile 按 base → web-app → uwork-desktop 顺序成功解析；真实浏览器固定快照重放通过，并检查了 1680/1000px 窗口中的浅暗品牌页面。桌面产品默认选择此 bundle，普通 Web profile 仍可独立选择。完整布局、问候和其余 UI 仍待迁入，T19 未整项验收。任务模式沿用 dsh 原生 Agent 预设与现有入口。

新品牌插件与 bundle 共七项测试通过，源码语句、分支、函数和行覆盖率均为 100%。发行约束测试与品牌测试共 174 项通过；约束和八语言元数据检查通过。最新运行时代码 build:artifacts 八项及其后的 build:check 两项通过，doc-sync 43 项通过。完整 lint 只有未改动文件中的既有 unused-disable 警告，新增文件最终 lint 通过。两个新包的独立 publint 通过，保留仓库既有 src 导出提示；完整 hygiene 的 vendor rescope 检查有六个迁移前问题，publint 读取 inspector 生成目录中的副本文件阻塞后被终止，不能报为全量通过。

## 桌面默认装配与恢复

`dshDesktopProduct.bundles` 追加产品必需层，开发启动、生产包集合、Electron Main、profile 初始化与恢复读取相同配置。生产依赖选择对 Windows x64 和 Mac ARM 均包含 UWork 界面包；缺少必需包、包声明或补丁会在修改用户 profile 前报错。已有 profile 补上必需层并保留后续用户 bundles；恢复备份用户 patch，只启用必需层并保留用户包文件。

真实构建后的 Desktop Host 已完成初始化、启动、故障恢复和再次启动。两次启动图均包含 UWork 且不含默认品牌模块，首页 HTML 包含 UWork Client 启动数据。此测试不调用模型或真实企业服务；两个独立进程并发执行同一流程也通过。必需包声明、补丁缺失及补丁损坏的回归检查通过。测试不构成 Electron GUI、签名资源或安装包验收，T06 的跨平台成品检查仍待后续打包完成。

相关九个单元测试文件通过；后续新增的缺失 bundle 声明回归用例及所在文件共 40 项通过，一项既有 Windows 路径大小写用例在 Mac 跳过。最终 build:artifacts 八项和后续 build:check 两项通过；构建后 Host 测试通过。冻结锁文件安装、包依赖策略和 workspace 发行约束检查通过。完整 lint 仅报告未修改文件中既有的 unused-disable 警告。

## 续接开发：页面基线、公开协议与 home 隔离

2026-11-10 从远端迁移分支续接；按用户最新指定读取 `Jas0nxlee/UWork_frontend` 的 `main`。新增[页面与状态基线](ui-baseline.md)，覆盖 U01–U12 的源组件、现有目标插槽、导航、状态和两平台检查维度；T01 的源码表已完成，源实际页面截图及交互验收仍待执行。原 `Jas0nxlee/UWork` 只作为前期调研来源，后续迁移以用户指定仓库的当前源码为准。

[企业与市场协议基线](protocol-baseline.md)记录匿名组织、SkillHub 发现、目录、版本解析和实际技能下载结果，五个请求均返回 HTTP 200。weather 1.0.0 的复合文件指纹与服务端一致；脱敏公开样本保存在 `tasks/fixtures/public-services/`，下载技能没有安装或执行。真实企微、Key、模型、统计及签名输入尚未取得，不将公开请求结果计为 T02 全项通过。

扩展既有 built Desktop profile 测试：在中文和空格用户路径内创建旧 `.uwork/v2`、`.uwork/cli`、`.dsh` 哨兵，先通过构建后的发行 bootstrap 解析默认 home，再启动真实 Host、调用捆绑 CLI 与其 pnpm 子进程、恢复必需 bundles 并再次启动。CLI 的 `list --depth=0 --json` 返回新 home 的真实 desktop profile 路径；显式 DSH_HOME 指向没有 desktop profile 的旧根时正确拒绝，未偷偷回到产品默认。全过程旧哨兵 SHA-256 和 mtime 不变。该测试在本次 Linux x64 环境已通过单进程及两个独立并发进程，不构成原生 Electron、跨平台安装或全部插件写路径验收，T05/T06 剩余项继续保留。

本次环境初始 Node 缺少开发头文件，首次 build:artifacts 在 native addon 阶段失败；改用工作区内官方同版本 Node 24.22.1（包含头文件）后，build:artifacts 八项通过。最新测试编辑后的 build:check 两项通过；相关产品身份/bundles 单元测试共 20 项通过，test:docs 21 项及 doc-sync 43 项通过。完整 lint 通过，仅有未改动 `client-ui-cot-translation` 文件中的既有 unused-disable 警告；任务目录五份文档的链接/段落及四份 JSON 另行检查通过。测试没有修改生产运行时代码或模型/Session 输出。

## 公司市场匿名目录（T14）

`boot/uwork-company-market` 提供独立的 `uworkCompanyMarket/search` Remote，`client/ui-uwork-company-market` 通过既有 `plugins.tab` 提供公司市场。UWork bundle 装配两者并固定初始 SkillHub 来源；普通 dsh Web 未启用此产品层时不增加入口。客户端不访问企业身份或 npm 安装动作，服务请求不携带授权头，内置来源没有删除操作。当前目录只读，技能内容安装、启停和 provider 仍由 T15–T16 实现。

Host 校验 HTTPS（回环测试允许 HTTP）、同源发现、数值游标、唯一技能和发布版本；拒绝跳转、畸形响应、循环游标及超限的不完整目录。全查询时限、字节、上游/结果页大小、页数、技能数及文本长度均为 Config 字段。搜索跨完整上游目录匹配标题、slug 和摘要；每次请求重新读取，无凭据、持久化缓存或安装写入。调用者取消和插件卸载会终止读取，卸载等待活动读取结束。

Client 取消旧查询并丢弃迟到结果，刷新失败保留最近结果、提示旧数据并提供重试；读取成功前不对旧查询翻页。注册和生成的 Remote 命名空间随插件及 slot 所有者释放。真实浏览器发现并修复了动态 Remote 挂载后仍需单独声明 Cordis 注入的问题；这不是仅靠手工 Context 单测能证明的装配行为。

构建后的 Host 实调 `https://aihub.ucas.com.cn/skillhub`，匿名读取 36 个技能。浏览器测试使用真实 Loader、Host、生成的 Remote 和 Plugins 页面，仅以本地 HTTP 服务替代外部 SkillHub；覆盖上游分页、结果分页、搜索、空结果、429 保留结果、重试、中文和英文。已生成并只读重放 owner-local ARIA 期望；原 UWork 品牌页面回放及构建后 Desktop Host/捆绑 CLI/恢复测试均通过；两个独立浏览器测试进程并发运行同一公司市场流程也通过。浅暗主题的 760px/1680px 页面及中文窄窗截图已经检查，长标题和翻页动作无裁切；本地证据在 `.artifacts/uwork-company-market/`。这不等于两平台原生 GUI 或安装包验收，整体产品/设计审查仍在 T22/T40。

验证：新包聚焦测试 61 项通过，源码语句、分支、函数和行覆盖率均为 100%；完整 `test:gui` 为 748 个文件通过、13,116 项通过、两项跳过。相关 bundle/包集合单元测试 26 项通过。最新 build:artifacts 八项及其后的 build:check 两项通过。doc-sync 43 项通过。完整 lint 通过，仅有未改动文件的既有 unused-disable 警告；冻结锁文件安装、workspace 约束、Client 本地化与发布依赖策略检查通过。两个新包的 publint 返回成功，保留仓库既有 src 导出提示和浏览器 closure-factory 的已知格式提示；未运行全量 hygiene。


## 公司技能安装与原生调用

公司市场支持匿名安装准确发布版本、更新、启停、卸载和重启恢复。下载绑定解析身份与同源已知路径，校验有界 ZIP、跨平台路径、链接/冲突、复合内容指纹和原生技能元数据；文件只保留所有者权限。不可变版本通过跨进程锁内的原子索引替换激活，失败保留旧版，确认未知时保留候选。技能读取使用无锁索引快照，下载期间旧版仍可读取，已提交旧路径保留至卸载。个人技能及 npm 插件不被修改。

Host 与 Client 的 208 项定向测试通过，涉及新增源码的语句、分支、函数和行覆盖率均为 100%。测试包括非法归档、资源限制、取消、丢失写入确认、损坏持久状态、重启清理、原生 provider 生命周期、个人同名技能和独立进程并发写入。GUI 回归 749 个文件通过，13,131 项通过、2 项跳过。最新构建八项和其后的类型检查两项通过；文档、包依赖与 workspace 检查通过。

真实公共服务匿名安装 `weather@1.0.0` 成功，复合指纹与协议样本一致；原生 provider 可读取，卸载后不再发现。该检查使用私有临时目录，没有执行下载内容。真实 Loader、Host 和生成 Remote 的浏览器场景完成页面安装、输入框技能发现与调用、Session 指令记录、启停和卸载；两个独立进程回放均通过。浅/暗主题、宽/窄窗及中文页面留有实际截图。此处证明源码、公共服务及浏览器闭环，不代表 Windows/macOS 安装包内验收，也不代表带身份企业接口联调。

## 企业垂直切片与展示整合

2026-11-10 并行实现已新增 `credentials/native-authorization`、`credentials/uwork-enterprise`、`boot/uwork-gateway`、`boot/uwork-gateway-service`、`llm/uwork-model-provisioning` 与两个企业 Client 包。产品 bundle 使用原仓库公开发行配置中的四组织，原生扫码由 Main 的独立隔离载体承接，授权地址和 callback 不进入 Renderer Remote；Host 持有 issuer 凭据和代际。公开模型网关来源由部署白名单限定为 `https://llm.ucas.com.cn:15000`，模型能力只接受同端点协议目录的明确声明。初始企业默认候选顺序为空，无交集时要求用户选模型，已有个人默认和 Session 选择不被覆盖。

首个完整切片构建已通过八个阶段；构建后真实 Desktop Host 已完成初始化、启动、故障恢复、捆绑 CLI 及旧目录 hash/mtime 隔离回放，私有 native state 返回四个组织且无 token/授权地址。原生 Host IPC 的 30 项真实子进程测试通过。身份 Host 的 39 项定向测试和原生载体/控制器/注册表的 34 项定向测试达到四项源码覆盖率 100%。这些是早期切片的版本信号；后续安全修复和新增呈现已纳入最新整合构建，最终源码验证见下节，不能把早期构建与真实发行验收混为一谈。

交叉审查已经发现并处理晚到扫码 start 遗留、默认模型并发覆盖、受管 route 编辑后的凭据 admission、Key POST 确认未知和断线旧账号数据保留等边界。相应回归、真实产品页面、文档图与依赖门禁已验证，证据随所属切片归档；本环境无法完成的发行条件另行保留。

发行侧已迁入原 UWork 图标资源，并使打包、版本发现和更新元数据使用独立 `uwork-next` 通道；Preview 拒绝 production、DeepSeek 旧 feed、旧 latest 覆盖及 purge。源仓库 Mac ad hoc 签名不构成 Developer ID 公证或 Windows Publisher 证据。真实员工两账号联调、Windows x64/Mac ARM 成品签名安装与连续升级仍未取得证据。可执行的 UI 差异和上游兼容审查分别见 [UI 差异复核](ui-migration-review.md) 与 [上游维护演练](upstream-maintenance.md)。


## 本次源码交付验证

- 最新完整构建八个阶段通过；其后 Host/Client 聚合类型检查两项通过。
- 完整 GUI：761 个文件通过，13,238 项测试通过、2 项跳过。验证保留原生 Agent、Session、队列、停止、审批和标签行为。
- 完整文档同步：43 项通过；发布依赖策略 102 包通过、workspace 约束通过。完整 typed/style lint 无错误，仅保留原有未改动文件的一项 unused-disable 警告。
- 所有新增业务包的定向源码语句、分支、函数和行覆盖率均为 100%。身份使用真实 Loader、credentials-local 和磁盘锁验证；两个禁用 watch 的独立实例证明注销后新能力回调不会执行，迟到结果也被拒绝。
- 真实 Linux Electron 验证独立会话、无 Node/主窗口 preload、取消/强制关窗/过期的存储清理；真实 Desktop Host 验证产品初始化、重启、故障恢复、捆绑 CLI 和旧目录 hash/mtime 不变。
- 真实产品浏览器验证账户、用量、匿名市场安装与原生技能调用、消息/工具/附件、模型菜单、队列/停止、审批/询问及工作台，覆盖浅暗、中文/英文、长内容、键盘和 390px 窄窗。认证服务采用明确标注的 HTTPS fixture，未冒充员工实调。
- 工作台另以真实 bash PTY 执行无副作用命令并验证关闭后 PID 退出；真实 XLSX Worker 拒绝编辑，DOCX 经既有 LibreOfficeKit/PDF Worker 显示中文，源文件保持不变。Office 编辑仍延期。

Preview 继续采用当前 app/runtime 清单版本 `0.2.2-rc.1`，独立 appId/userData/protocol/feed namespace；不自动导入旧 UWork 或 `.dsh` 数据，也不覆盖旧更新源。正式签名版本、Publisher、部署 feed 与平台验收属于尚未完成的发行条件。完整呈现采纳与保留理由、准确截图运行目录及证据边界见 [UI 复核](ui-migration-review.md)。

最终可达代码提交已执行上游只读合并审计：12 个共享扩展范围、相对固定上游 521 个变化文件，merge-tree 成功且 tree 与代码提交一致。精确命令保存在 `tasks/fixtures/upstream-maintenance.json` version 2；固定上游为共同祖先，此结果不代表未来双边分歧无冲突。
