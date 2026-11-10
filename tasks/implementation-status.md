# UWork 迁移实施记录

## 当前进展

2026-11-10，在 `codex/uwork-desktop-migration` 分支开始实施。当前已完成桌面身份与路径基础改造，并增加可选的 UWork 品牌层；整个迁移尚未完成。[执行清单](todo.md)保留尚未验收的事项。

发行元数据集中在 `apps/desktop/package.json` 的 `dshDesktopProduct`，由 Electron Main、捆绑 CLI、构建与产物脚本共同读取。默认产品名和 Electron 存储目录为 UWork Next Preview，home 为 `.uwork/harness-preview`，外部协议为 `uwork-next`，安装包前缀为 `uwork-next`。显式 DSH_HOME 优先，未声明发行元数据的普通 dsh 清单保持原行为。

打包、公证、产物 smoke、版本发现、上传计划、下载页和保留产物检查已改为读取集中名称。隔离的安装升级资格测试不继承日常产品存储身份。内部运行时版本和 Session 格式未变，旧 UWork 数据没有执行自动导入。

## 已执行检查

- Desktop 和 Desktop Host 测试：185 个文件通过、5 个文件跳过；2221 项测试通过、60 项跳过。测试包含平台模拟和本地测试服务，不代表真实签名或跨平台安装。
- build:artifacts：8 项检查通过；其后的 build:check：2 项通过。
- test:docs：21 项通过；doc-sync：43 项通过。
- lint：已修复新代码的格式问题；完整检查仅报告一个未改动文件中的既有 unused-disable 警告。
- git diff --check：通过。

## 尚未完成

UWork UI 目前只有可选的品牌层；企微与模型自动配置、公司 SkillHub 市场、企业网关统计尚未接入。原生图标、文案、独立更新部署及 bundle 恢复集合尚未完成。当前没有生成并验收 Windows x64 或 Mac ARM 安装包，也没有进行真实登录或安装升级验收。

Office 编辑按用户最新要求延期。正式发布前仍须完成执行清单全部必交付项。

## Office 编辑延期

2026-11-10 按用户要求删除本轮新增的 Office Client 编辑器、Host 文件服务及独立 bundle，包括依赖、远程接线、配置、类型引用、文档和测试。为 Office 编辑单独新增且没有其他消费者的二进制写入和标签关闭守卫同步撤回。保留原有 dsh Office 只读预览与转换，以及桌面发行身份、启动路径和严格发行文件校验。Office 不再属于当前实现或发布验收范围。

删除后检查：冻结锁文件安装通过；文件系统、SSH 和右侧栏共 49 个测试文件、763 项测试通过，4 项跳过；build:artifacts 八项及其后的 build:check 两项通过；构建产物启动两项通过；doc-sync 43 项通过。完整 lint 通过，保留未改动文件中的既有 unused-disable 警告。此次删除时，`packages/` 和 `apps/web/` 与迁移起点的源码差异已清零，当时仅保留桌面底座及相应方案文档的迁移改动。

## UWork 界面插件接入

空白首页新增独立的 `conversation.hero.brand.title` 插槽，和既有图标、背景插槽共同支持品牌呈现。没有占用者时仍显示原本的本地化标题；替换标题保留预览标记和常驻输入框。

Conversation 相关 55 个测试文件、904 项测试通过；build:artifacts 八项及其后的 build:check 两项通过；默认页面构建产物启动两项通过；doc-sync 43 项通过。此检查验证默认页面和标题扩展能力，不代表 UWork 全套 UI 或桌面发行已完成。

已增加可选的 `client/ui-uwork` 和 `bundle/uwork-desktop`，通过侧栏、首页标题、图标和背景插槽显示 UWork/UCAS 资源，bundle 同时禁用默认品牌层。源资产保留 Apache-2.0 许可与来源记录，许可文件列入严格发行清单。真实 CLI 的临时 profile 按 base → web-app → uwork-desktop 顺序成功解析；真实浏览器固定快照重放通过，并检查了 1680/1000px 窗口中的浅暗品牌页面。当前还没有内置到默认桌面 profile 和签名 runtime，T06 只完成建立 bundle 的子项；完整布局、模式、问候和其余 UI 仍待迁入，T19 未整项验收。

新品牌插件与 bundle 共七项测试通过，源码语句、分支、函数和行覆盖率均为 100%。发行约束测试与品牌测试共 174 项通过；约束和八语言元数据检查通过。最新运行时代码 build:artifacts 八项及其后的 build:check 两项通过，doc-sync 43 项通过。完整 lint 只有未改动文件中的既有 unused-disable 警告，新增文件最终 lint 通过。两个新包的独立 publint 通过，保留仓库既有 src 导出提示；完整 hygiene 的 vendor rescope 检查有六个迁移前问题，publint 读取 inspector 生成目录中的副本文件阻塞后被终止，不能报为全量通过。
