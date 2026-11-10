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

UWork UI、企微与模型自动配置、公司 SkillHub 市场、企业网关统计和 Office 编辑 bundle 尚未接入。图标、原生文案、独立更新部署及 bundle 恢复集合尚未完成。当前只是可编译、经源码测试的基础改造，没有生成并验收 Windows x64 或 Mac ARM 安装包，也没有进行真实登录、Office 往返保存或安装升级验收。

下一实现单元为 UWork/Office bundle 装配，以及 Office 二进制保存和关闭守卫所需的通用接口。正式发布前仍须完成执行清单全部必交付项。


## Office 二进制保存进展

已增加 `FileSystem.writeBytes` 及不含文本 diff 的结果类型，并接入 LocalFileSystem、SandboxedFileSystem 和 SSH helper。保存捕获固定字节快照，与文本操作共用目标锁；必填新建或版本替换意图，暂存后重新检查版本再发布。Windows 沿用已有 DACL/替换逻辑，取消和冲突保留目标文件。备份与编辑器关闭保护仍由后续 Office 服务实现。

本轮验证了二进制往返、陈旧版本、并发保存、暂存时外部修改、取消清理、调用方继续修改 Uint8Array/Buffer、沙箱只读/越界/链接逃逸，以及 SSH 实际 helper 分发和非法编码拒绝。已有文件工具、技能和指令读取消费方回归 614 项通过。此证据仍不代表 Office 编辑器或真实两平台文件往返验收完成。
