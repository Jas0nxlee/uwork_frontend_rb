# Agent Note: UWork Preview 发行隔离

Status: implemented

[English](2026-11-10-uwork-preview-release-isolation.md) | 中文

## 问题

桌面 fork 即使显示新产品名，也可能仍打包上游图标、嵌入上游升级 feed 或覆盖固定网站安装器。共享发行目标会让 Preview 构建影响现有 dsh 安装，即便用户数据目录已经隔离。

## 决策

UWork Next Preview 使用桌面应用 manifest 声明的产品身份。打包原样选用现有 UWork 原生图标。来源提交及资源哈希记录在[品牌资源](../../../../apps/desktop/resources/uwork/README.zh.md)旁。其他产品选择保留原图标。

升级解析器接受显式发行身份。UWork Preview 的 feed 与二进制键均使用 `uwork-next/<release-id>`，要求独立 HTTPS 测试域名，并拒绝旧 production 部署与 DeepSeek 域名。未选择 UWork 发行时，纯解析器保持现有 dsh 行为。

Builder 配置、打包完成记录、macOS 产物组装、环境校验、下一版本发现及凭据目标核对均传递相同发行身份。普通上传计划读取实际应用 manifest。留存发布改为读取不可变的源发行标记；旧留存 manifest 显式选择旧命名空间，不查询当前 checkout。Preview 在加载发行凭据前拒绝固定网站安装器替换及 purge，不能通过这些命令写入或清除 `dsh-latest`。

此决策记录已实现的品牌与发行路由切片，不表示整个桌面迁移完成。产品分类将企业身份、原生授权、网关协议与编排、托管模型配置保持为 UWork 组合的可选能力。README 审计区分认证与传输职责，以及原生 provider adapter 拥有的模型请求职责。

固定上游兼容基线保存在版本控制的[审计记录](../../../../tasks/fixtures/upstream-maintenance.json)中。仓库引用门禁仅在这一精确证据路径、且内容为规范可读 JSON 并满足有界版本化 schema 时接纳 commit 身份：固定只读命令参数、匹配的成功输出、十六进制对象 ID、已审查的共享源码范围，以及未改分支、索引或工作区的固定声明。额外字段、任意叙述、非法 ID、失败命令及其他路径上的相同内容仍执行普通引用检查。此最窄证据规则保留可复核的 T40 基线，不放开维护正文中的历史 commit 链接。

## 考虑过的替代方案

**复用上游升级命名空间。** 未采用，因为独立应用名与 home 无法阻止 feed 元数据或固定安装器写入影响上游用户。

**关闭 Preview 的全部升级路径。** 未采用，因为独立测试命名空间保留可重复的签名升级验收，同时旧 production 与网站目标保持关闭。

**重新绘制 UWork 图标。** 未采用，因为用户提供的现有产品仓库已包含原生品牌资源。复用这些文件保留用户提供的产品标志及已记录的源文件哈希。

**只把固定基线留在 scratch。** 未采用，因为 reviewer 拿到 clone 后会失去精确审计输入与观察输出。版本控制的 schema 保留这些事实，同时维持普通维护引用限制。

## 影响

Preview 候选可以复用 dsh 打包机制而不共享升级对象。签名 Preview 需要独立测试域名、release ID 及签名环境。此发行有意拒绝现有 production preset。未签名候选仍为独立产物，不含升级配置。

Linux 开发环境尚未验证真实 Windows x64 与 Mac ARM 的签名、安装和升级。目前没有绑定签名 secret 或平台测试机。原 UWork macOS workflow 的 ad hoc 签名不是 Developer ID 或公证证据。真实员工登录、配置后推理及账号切换需要已认证测试身份。公开服务发现与合成 fixture 不能满足这些检查。

[发行验收矩阵](../../../../apps/desktop/resources/uwork/README.zh.md)维护所需平台证据。本次变更没有上传产物、公开发布、切换旧 feed 或操作签名令牌。

## 测试

定向测试验证独立 feed 与二进制路径、拒绝旧 production 与 DeepSeek 域名、提前拒绝固定安装器与 purge、保留普通 dsh 解析器行为、打包原生品牌、macOS feed 组装及上传计划校验。相关打包、环境与下一版本测试通过。这些属于源码与 fixture 检查；模拟签名或上传日志不是实际发行证据。

仓库引用测试还验证精确审计 fixture 可通过，并拒绝改名路径、扩大的 schema、任意命令、非法对象身份、失败输出与尾随叙述。

留存 manifest 继续使用 schema version 1，新增可选 `source.distribution.artifactStem`。新留存从已校验的打包身份提取标记；旧 manifest 仍可读取。旧严格发布器需升级才能读取新定制 manifest。完成记录 URL 继续约束目标：Preview 标记缺失或错误不能把 Preview 完成记录转到旧 feed。机械持久化检查报告 66 个 root、24 条历史记录均未变；此 CI manifest 不在其目录内，因此本备注与 CI 发布参考文档记录兼容性确认。

主机 flock 就绪探测现仅检查当前平台/libc 的 Node-API flock 二进制。仅构建主机 addon 不要求 landlock 或另一 libc 二进制。可执行模式 fixture 在缓存复用测试前显式建立预期模式，保留限制性 runner umask 下的原断言。13 个定向发行文件通过 151 项测试，另有两项平台专用跳过，覆盖跨进程缓存发布、真实 addon 加载、留存身份与完成记录一致性。
