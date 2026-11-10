# UWork 迁移实施记录

## 当前进展

2026-11-10，在 `codex/uwork-desktop-migration` 分支开始实施。当前已完成桌面身份与路径基础改造，UWork 品牌层已接入桌面产品的启动、打包和恢复配置；整个迁移尚未完成。[执行清单](todo.md)保留尚未验收的事项。

发行元数据集中在 `apps/desktop/package.json` 的 `dshDesktopProduct`，由 Electron Main、捆绑 CLI、构建与产物脚本共同读取。默认产品名和 Electron 存储目录为 UWork Next Preview，home 为 `.uwork/harness-preview`，外部协议为 `uwork-next`，安装包前缀为 `uwork-next`。显式 DSH_HOME 优先，未声明发行元数据的普通 dsh 清单保持原行为。

打包、公证、产物 smoke、版本发现、上传计划、下载页和保留产物检查已改为读取集中名称。隔离的安装升级资格测试不继承日常产品存储身份。内部运行时版本和 Session 格式未变，旧 UWork 数据没有执行自动导入。

## 已执行检查

- Desktop 和 Desktop Host 测试：185 个文件通过、5 个文件跳过；2221 项测试通过、60 项跳过。测试包含平台模拟和本地测试服务，不代表真实签名或跨平台安装。
- build:artifacts：8 项检查通过；其后的 build:check：2 项通过。
- test:docs：21 项通过；doc-sync：43 项通过。
- lint：已修复新代码的格式问题；完整检查仅报告一个未改动文件中的既有 unused-disable 警告。
- git diff --check：通过。

## 尚未完成

UWork UI 目前只有品牌层；企微与模型自动配置、公司技能安装和企业网关统计尚未接入；公司市场匿名目录已接入，见后续记录。原生图标、文案和独立更新部署尚未完成。当前没有生成并验收 Windows x64 或 Mac ARM 安装包，也没有进行真实登录或安装升级验收。

Office 编辑按用户最新要求延期。正式发布前仍须完成执行清单全部必交付项。

## Office 编辑延期

2026-11-10 按用户要求删除本轮新增的 Office Client 编辑器、Host 文件服务及独立 bundle，包括依赖、远程接线、配置、类型引用、文档和测试。为 Office 编辑单独新增且没有其他消费者的二进制写入和标签关闭守卫同步撤回。保留原有 dsh Office 只读预览与转换，以及桌面发行身份、启动路径和严格发行文件校验。Office 不再属于当前实现或发布验收范围。

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
