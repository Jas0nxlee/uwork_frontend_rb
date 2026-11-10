# UWork 迁移实施记录

## 当前进展

2026-11-10，在 `codex/uwork-desktop-migration` 分支开始实施。当前已接入桌面身份与路径基础、二进制写入、侧栏关闭协商和 Office 文件 Host 服务；整个迁移尚未完成。[执行清单](todo.md)保留尚未验收的事项。

发行元数据集中在 `apps/desktop/package.json` 的 `dshDesktopProduct`，由 Electron Main、捆绑 CLI、构建与产物脚本共同读取。默认产品名和 Electron 存储目录为 UWork Next Preview，home 为 `.uwork/harness-preview`，外部协议为 `uwork-next`，安装包前缀为 `uwork-next`。显式 DSH_HOME 优先，未声明发行元数据的普通 dsh 清单保持原行为。

打包、公证、产物 smoke、版本发现、上传计划、下载页和保留产物检查已改为读取集中名称。隔离的安装升级资格测试不继承日常产品存储身份。内部运行时版本和 Session 格式未变，旧 UWork 数据没有执行自动导入。

## 已执行检查

- Desktop 和 Desktop Host 测试：185 个文件通过、5 个文件跳过；2221 项测试通过、60 项跳过。测试包含平台模拟和本地测试服务，不代表真实签名或跨平台安装。
- build:artifacts：8 项检查通过；其后的 build:check：2 项通过。
- test:docs：21 项通过；doc-sync：43 项通过。
- lint：已修复新代码的格式问题；完整检查仅报告一个未改动文件中的既有 unused-disable 警告。
- git diff --check：通过。

## 尚未完成

UWork UI、企微与模型自动配置、公司 SkillHub 市场、企业网关统计和 Office 编辑 bundle 尚未接入。图标、原生文案、独立更新部署及 bundle 恢复集合尚未完成。当前只是可编译、经源码测试的基础改造，没有生成并验收 Windows x64 或 Mac ARM 安装包，也没有进行真实登录、Office 往返保存或安装升级验收。

下一实现单元为 Office Client 编辑器、公共保存生命周期及 bundle 装配。正式发布前仍须完成执行清单全部必交付项。


## Office 二进制保存进展

已增加 `FileSystem.writeBytes` 及不含文本 diff 的结果类型，并接入 LocalFileSystem、SandboxedFileSystem 和 SSH helper。保存捕获固定字节快照，与文本操作共用目标锁；必填新建或版本替换意图，暂存后重新检查版本再发布。Windows 沿用已有 DACL/替换逻辑，取消和冲突保留目标文件。备份与编辑器关闭保护仍由后续 Office 服务实现。

本轮验证了二进制往返、陈旧版本、并发保存、暂存时外部修改、取消清理、调用方继续修改 Uint8Array/Buffer、沙箱只读/越界/链接逃逸，以及 SSH 实际 helper 分发和非法编码拒绝。已有文件工具、技能和指令读取消费方回归 614 项通过。此证据仍不代表 Office 编辑器或真实两平台文件往返验收完成。


## Office 未保存关闭保护进展

已在 sidebarRight 控制器增加可撤回的关闭 guard，保留原同步清理回调。显式关闭、替换文档及菜单批量关闭会等待编辑所有者的保存/放弃/取消决定；重复请求合并，同一批次按顺序处理并在取消时停止。迟到确认不能影响已撤回的 occurrence 或释放的 Session store。准备失败由编辑插件负责显示，原标签保持。

侧栏相关 21 个测试文件、335 项测试通过；关闭控制器 service.ts 的语句、分支、函数和行覆盖率均为 100%。最终 GUI 检查 745 个文件通过，13107 项通过、1 项跳过，覆盖现有客户端和 Host 页面。当前 shipped composition 尚未注册 Office guard，既有页面渲染保持；需要在编辑插件接入后验证真实页面的保存弹窗和焦点。原生窗口退出、插件停用/升级前检查与强制终止草稿恢复仍待实现，T25 不标为整项完成。


## Office 文件 Host 插件进展

已增加独立可选插件 `document/uwork-office-storage`，提供能力查询、普通文件 stat、完整字节读取，以及带版本或新建意图的保存 Remote。打开时读取前后核对版本；保存接入已有 `fs.writeBytes`。所有目标限制在会话工作区内，拒绝只读保存、末级链接、目录、越界及链接逃逸。文档大小与并发操作数可配置，Base64 编码与解码后均检查上限；卸载取消并等待活动请求结束。新插件没有加入普通 dsh 默认装配。

源码两文件 29 项测试通过，核心 index.ts 的语句、分支、函数和行覆盖率均为 100%；另有构建产物 profile 一项通过。两种 profile 检查都由真实 dsh 启动并经 Loader 加载，验证了中文路径、二进制往返和陈旧版本拒绝。最新运行时代码 build:artifacts 8 项、其后的 build:check 2 项及 doc-sync 43 项通过；lint 只剩既有的 unrelated unused-disable 警告。固定锁文件离线安装通过，保留供应链检查。

能力查询报告当前策略，不等同于授予访问权。完整的 Client 远程调用、编辑器实际打开、原生工作区外另存为授权、备份/草稿和格式校验仍待接入，因此 T26 继续保持未整项验收；未把文件服务的原始字节测试计为 Office 格式保真或两平台安装包验收。

完整 hygiene 检查发现了此前桌面身份改造遗漏的严格发行文件清单，已在独立提交中补齐 product.js 及声明文件的必需项，并通过约束检查与 167 项约束测试。另有既有 vendor rescope 检查失败：vendor/README 的旧编号条件与五处旧名称残留；相应六个文件与本迁移起点没有差异，未修改或放宽该检查。此项保留为现存验收缺口，不能把完整 hygiene 报为通过。
