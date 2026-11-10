# UWork 迁移实施记录

## 当前进展

2026-11-10，在 `codex/uwork-desktop-migration` 分支开始实施。当前完成的是桌面身份与路径基础改造，整个迁移尚未完成。[执行清单](todo.md)保留尚未验收的事项。

发行元数据集中在 `apps/desktop/package.json` 的 `dshDesktopProduct`，由 Electron Main、捆绑 CLI、构建与产物脚本共同读取。默认产品名和 Electron 存储目录为 UWork Next Preview，home 为 `.uwork/harness-preview`，外部协议为 `uwork-next`，安装包前缀为 `uwork-next`。显式 DSH_HOME 优先，未声明发行元数据的普通 dsh 清单保持原行为。

打包、公证、产物 smoke、版本发现、上传计划、下载页和保留产物检查已改为读取集中名称。隔离的安装升级资格测试不继承日常产品存储身份。内部运行时版本和 Session 格式未变，旧 UWork 数据没有执行自动导入。

## 已执行检查

- Desktop 和 Desktop Host 测试：185 个文件通过、5 个文件跳过；2221 项测试通过、60 项跳过。测试包含平台模拟和本地测试服务，不代表真实签名或跨平台安装。
- build:artifacts：8 项检查通过；其后的 build:check：2 项通过。
- test:docs：21 项通过；doc-sync：43 项通过。
- lint：已修复新代码的格式问题；完整检查仅报告一个未改动文件中的既有 unused-disable 警告。
- git diff --check：通过。

## 尚未完成

UWork UI、企微与模型自动配置、公司 SkillHub 市场、企业网关统计尚未接入。图标、原生文案、独立更新部署及 bundle 恢复集合尚未完成。当前只是可编译、经源码测试的基础改造，没有生成并验收 Windows x64 或 Mac ARM 安装包，也没有进行真实登录或安装升级验收。

Office 编辑按用户最新要求延期。正式发布前仍须完成执行清单全部必交付项。

## Office 编辑延期

2026-11-10 按用户要求删除本轮新增的 Office Client 编辑器、Host 文件服务及独立 bundle，包括依赖、远程接线、配置、类型引用、文档和测试。为 Office 编辑单独新增且没有其他消费者的二进制写入和标签关闭守卫同步撤回。保留原有 dsh Office 只读预览与转换，以及桌面发行身份、启动路径和严格发行文件校验。Office 不再属于当前实现或发布验收范围。

删除后检查：冻结锁文件安装通过；文件系统、SSH 和右侧栏共 49 个测试文件、763 项测试通过，4 项跳过；build:artifacts 八项及其后的 build:check 两项通过；构建产物启动两项通过；doc-sync 43 项通过。完整 lint 通过，保留未改动文件中的既有 unused-disable 警告。`packages/` 和 `apps/web/` 与迁移起点的源码差异已清零，当前仅保留桌面底座及相应方案文档的迁移改动。
