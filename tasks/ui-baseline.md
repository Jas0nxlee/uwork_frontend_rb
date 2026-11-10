# UWork 页面与状态基线

本表是 T01 的源码范围基线，供 T19–T22 和 T38 逐项验收；不表示页面已迁入或完成视觉验收。源为 用户指定的 `Jas0nxlee/UWork_frontend` 的 `main` 分支，读取日期为 2026-11-10，提交为 `f6dda23d7e6f39aa66804933b60f893d38ab6914`。目标为本分支的 dsh Client 插槽与原生 Desktop；Office 编辑、Git 图、Workflow 编辑器和远控独立页面不在此表内。

## 页面、导航与所有者

源组件路径相对源仓库 `packages/ui/src/`；目标路径相对本仓库 `packages/client/`。目标 slot 名是当前声明，标为“需扩展”的地方不能通过重复注册 single slot 实现。

| 编号与入口 | 源组件 | 目标组件或接入点 | 迁移与导航约束 |
|---|---|---|---|
| U01 首次启动、账号登录 | `login/EnterpriseLoginPage.tsx`、`login/EnterpriseQrSurface.tsx` | `apps/desktop/src/welcome-backend.ts`；`ui-settings` 的 `settings.onboarding`、`settings.section` | 原生 Welcome 需扩展认证接入；原生和设置共享企业 Host 状态，扫码载体不能把 token 交给页面 |
| U02 首页、新任务 | `WelcomeScreen.tsx`、`openWorkspacePageThemeHero.tsx` | `ui-conversation/src/client/skeleton/EmptyHero.tsx`；`conversation.hero.brand.mark/title`、`conversation.hero.frame/workspace/agentPreset` | 品牌插件已有贡献；保留 dsh 原生预设选择、工作区选择和常驻输入框 |
| U03 任务导航与搜索 | `WorkspaceSidebar.tsx`、`TaskList.tsx`、`TaskSearchDialog.tsx` | `ui-sidebar/src/client/contract/slots.ts` 的 `sidebar.brand.mark/name`、`sidebar.panellist`；`ui-layout/src/client/AppFrame.tsx` | 布局和任务列表仍由现有所有者持有；紧凑 presenter 如需替换须先扩展通用接口；禁止复制源任务 store |
| U04 对话记录与工具 | `v4/V4ChatPane.tsx`、`ToolCallBlocks.tsx`、`ChatErrorBanner.tsx` | `ui-chat/src/client/contract/slots.ts`；`conversation.view`、`conversation.chat.reasoning.body`、`conversation.chat.assistant-actions` | 使用 dsh Session 投影、工具 presenter、消息操作；不导入旧 ZCode RPC |
| U05 输入、模型、附件 | `LexicalChatInput.tsx`、`ModelConfigSelect.tsx`、`ChatMediaAttachmentPreviewDialog.tsx` | `conversation.composer`、`conversation.composer.bar`、`conversation.input.model/permission/plan/left/right` | 保留输入队列、停止、草稿、模型显式选择与附件行为；源模式名不替换 dsh Agent 预设 |
| U06 审批与询问 | `PermissionDialog.tsx`、`ElicitationDialog.tsx` | `ui-user-questions`、`ui-tool` 与既有审批贡献 | 沿用 dsh 权限及询问结果记录；取消、拒绝不能表现成批准 |
| U07 工作台 | `PreviewPane.tsx`、`SidePaneTerminalPane.tsx`、`EmbeddedBrowserPaneParts.tsx` | `ui-sidebar-right/src/client/contract/slots.ts` 的 `sidebar.right.pane.tab`；现有 files/browser/terminal/document 插件 | 复用标签注册与会话资源；保留既有 Office 只读预览，不新增编辑入口 |
| U08 通用设置、外观与语言 | `SettingsPage.tsx`、`settings/SettingsPageParts.tsx`、`useTheme.ts` | `ui-settings` 的 `settings.section/general.item`；`ui-theme` | 设置 shell 是唯一导航所有者；主题和语言仍走现有偏好服务 |
| U09 账号与模型设置 | `login/EnterpriseIdentityBadge.tsx`、`settings/ModelProviderSection.tsx` | 企业插件贡献 `settings.section/onboarding/launcher`；现有模型配置页 | 企业身份独立于 DeepSeek account；保留个人 provider 配置入口与默认选择 |
| U10 插件、公司市场、技能管理 | `settings/PluginStorePage.tsx`、`settings/PluginsSection.tsx` | `ui-plugin-manager/src/client/slot-contract.ts` 的 `plugins.tab`；企业市场自有安装服务 | PUBLIC 目录匿名可读；技能内容安装不调用 owner 的 npm `install` 动作；已装技能单独管理 |
| U11 使用统计、企业网关 | `settings/UsageStatsSection.tsx`、`settings/ucas-gateway/UcasGatewayPanel.tsx`、`settings/ucas-gateway/GatewayUsageSection.tsx` | `settings.section` 中企业统计贡献；本地统计保持原所有者 | 明确本地与网关数据来源；企业统计服务待实现，不能以本地 token 汇总替代 |
| U12 原生窗口、关于、更新与恢复 | `DesktopWindowFrame.tsx`、`DesktopWindowControls.tsx`、`updateStatusModel.ts` | `apps/desktop/src/main.ts`、集中 `dshDesktopProduct` 与现有更新/恢复窗口 | Windows 标题栏和 macOS traffic lights 分别验收；菜单、图标、更新目的地须独立检查 |

## 状态验收表

每行的正常、等待、空与失败均需在装配后的真实页面验证。编辑仅指当前范围内的草稿或设置；Office 编辑不纳入。

| 页面组 | 正常与等待 | 空、失败和身份状态 | 编辑、取消与恢复 |
|---|---|---|---|
| U01、U09 | 获取组织、生成扫码、等待、交换、已登录、网关同步、ready | 无组织配置、二维码过期、错误组织、认证失败、已登录但模型配置失败、重启恢复失败 | 取消/关闭扫码、注销、切账号、重试；过时回调不得提交；个人模型不丢 |
| U02、U03 | 首屏加载、选工作区、加载任务列表、搜索、切换任务 | 无任务、无搜索结果、工作区失联、任务加载失败 | 新任务草稿、重命名、归档、折叠/展开；刷新及多面板恢复选择 |
| U04、U05 | 流式正文/推理/工具、排队、上传、模型加载、停止处理中 | 空对话、无模型、模型撤权、附件失败、断网、工具失败、取消 | 草稿与附件保留、队列编辑、复制/重试、切模型；Session 显式选择不被后台同步改写 |
| U06 | 等待批准、输入回答、提交中 | 权限拒绝、请求过期、提交失败 | 键盘选择、取消/拒绝、重试；焦点返回触发处，后台任务不吞掉待处理提示 |
| U07 | 文件加载、预览、终端启动、浏览器导航、标签切换 | 空目录、文件消失、权限错误、不支持的预览、进程退出、导航失败 | 标签与面板恢复、终端输入/退出、文档只读；长路径和多标签操作可达 |
| U08、U09 | 读设置、保存、切语言、切浅暗/系统主题、同步模型 | 无企业身份、无授权模型、配置冲突、凭证失效、保存失败 | 未保存设置、刷新/替换 Key 的明确动作；保存失败保留输入，切账号取消旧请求 |
| U10 | 发现来源、分页、搜索、解析版本、下载/校验/激活、更新 | 未登录可浏览、空目录、无搜索结果、断网、429、损坏包、版本冲突 | 取消安装、失败保留旧版、启停/卸载、重启恢复；内置来源不可误删 |
| U11 | 取数、筛选、手动刷新、同步配置、展示缓存时间 | 未登录、无账单、401/403/429、超时、统计失败 | 切周期/指标丢弃旧响应；失败保留旧数据与时间，不显示成零；身份切换清缓存 |
| U12 | 启动、离线首开、发现更新、下载/安装、恢复 | 无更新、更新服务失败、签名/哈希失败、插件启动失败 | 更新重试、运行任务时退出、恢复必需 bundles、新旧产品并行；分别在实际安装包检查 |

## 共用验收条件

每个页面组记录平台、版本、主题、语言、窗口尺寸、具体状态、操作结果和截图或录屏位置。浅/暗、中文/英文、长内容、窄窗口、键盘/焦点、菜单 Escape/外点关闭、加载和失败反馈、Windows/macOS 顶栏均是检查维度；只在对应布局与状态确实等价时复用证据。检查受约束宽度、断点两侧及长名称，保证操作不被裁切。

导航顺序覆盖首页 → 任务 → 对话/工作台 → 设置 → 企业账号/模型 → 公司市场 → 企业统计 → 返回原任务，检查草稿、任务选择和面板恢复。保留已有 dsh 功能及预设入口；源超范围独立业务不增加占位按钮。每个 single slot 保留一个所有者；新增通用 presenter 必须保留服务和子槽位。

## 当前证据与缺口

此基线来自源组件与目标 slot 声明交叉检查。已有品牌页面证据见[实施记录](implementation-status.md)。本轮没有生成源实际页面截图，未完成逐页交互比对、企业真实登录或两平台安装验收；这些结果不得由此表推定。T19–T22 应按 U01–U12 记录实现和差异，T38 补两平台证据；T01 的实际页面基线保持未验收。
