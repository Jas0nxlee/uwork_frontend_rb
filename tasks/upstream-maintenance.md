# UWork 上游维护与兼容演练

本记录覆盖本轮共享上游改动的兼容边界和一次无工作区变更的合并演练，不表示真实平台验收或发行获批。任务状态仍以 [执行清单](todo.md) 为准。

## 固定基线与演练结果

最终代码已提交后，对可达产品集成提交执行只读审计。精确对象、观察时间、原始命令和输出均保存在[版本控制证据](fixtures/upstream-maintenance.json)的 version 2 记录中。`snapshotCommit` 与 `head` 相同，普通 clone 可以获取该代码提交；后续文档提交更新审计记录、任务状态及文档格式与措辞，不改变产品代码。

| 对象 | 观察值或原始证据字段 |
| --- | --- |
| origin/master | `git ls-remote origin refs/heads/master` 的实际返回值，证据 `upstream` |
| 可达代码提交 | 证据 `head` / `snapshotCommit` |
| merge-base | 与固定上游相同，证据 `mergeBase` |
| 已提交代码 tree | 证据 `snapshotTree` / `mergeTreeStdout` |

`git merge-tree --write-tree <upstream-object> <head-object>` 退出码为 0，无 stderr，合并 tree 与代码提交 tree 一致。相对固定上游共 521 个文件发生变化。审计未创建临时 commit，未修改实际索引、工作区、当前分支或 ref，也未执行实际 merge、checkout 或 reset。

当前固定上游是共同祖先，所以这次结果证明已提交代码可合入该固定基线，没有双边分歧；它不能预测未来上游修改相同位置时的冲突。早期 version 1 的四目录混合工作区观察已由此次完整、可达的代码证据替代；验证器保留对历史 version 1 记录的严格兼容测试。

version 2 的审计范围固定为 `apps/desktop`、`apps/desktop-host`、`packages/client/ui-attachment`、`packages/client/ui-chat`、`packages/client/ui-conversation`、`packages/client/ui-dockkit`、`packages/client/ui-primitives`、`packages/client/ui-sidebar`、`packages/client/ui-sidebar-right`、`packages/client/ui-tool`、`packages/core/agent-default-model`、`packages/llm/llm-pi-ai`。这覆盖最终共享扩展面。验证器仅接受同一证据路径的精确字段、规范 JSON、两条成功命令及固定说明；范围增删、快照与代码 HEAD 不一致、额外文字或字段均不会获得引用门禁例外。

## 新增公共扩展面

| 扩展面 | 兼容行为 | 上游升级时必须复核 |
| --- | --- | --- |
| `sidebar.frame` root HOC slot；`SidebarFrameOwnerProps` 导出 | 只提供 `collapsed`、`drawer` 展示状态和现有 children；原生 sidebar 继续拥有导航、折叠、drawer、宽度和子 slot。无展示层时应原样呈现；层撤销后原生动作继续有效 | `SidebarRoot.tsx` 返回结构、slot 组合、触摸 drawer 和折叠几何；直接伪造 `renderSlot` 的测试 fixture 必须透传 HOC children |
| 可选 `PiAiAdapterOptions.prepareSignal`；`llm-pi-ai/request-signal` 同步 waterfall | 无监听器时不增加授权限制；已有 header hook 不变。监听器对无关路由调用 next，可拒绝精确捕获路由或返回撤销 signal；拒绝发生在凭据解析前 | 路由捕获是否仍不可变；凭据解析前门禁；signal 与 caller/consumer signal 合并；附件和实际推理是否均被终止；不能把该 hook 扩展为异步请求或静默吞掉拒绝 |
| 可选 `dshDesktopProduct` 和产品 home/bundle 选择 | 无产品元数据时保留上游默认；显式 DSH_HOME 优先。Preview 使用独立名称、appId、协议、artifact stem、home 和 bundle，未导入旧 UWork/dsh 数据 | Main/Host/bundled CLI 启动顺序、子进程环境、profile 初始化/修复、打包 runtime 和独立版本语义 |
| 私有 Host/Main native authorization IPC（协议 5） | 不进入 renderer Remote bus；没有 provider 时保留标准 Welcome；错误只返回固定安全诊断。退出和取消等待 owned 操作及 provider cancellation settle，晚到 start 结果也撤销 | Host ready/restart/dispose 顺序、请求关联、provider 生命周期、原生窗口 sender/navigation 边界、旧平台账号与退出检查 |
| updater resolver 可选 distribution 参数 | 普通 dsh 调用保持旧路径；Preview 显式传产品身份，使用独立 `uwork-next/<release-id>` 测试 feed/bin。production、DeepSeek 域名和旧网站 installer/purge 拒绝 | builder、完成记录、macOS 组装、环境预检、版本发现、凭据目标和上传计划是否持续使用同一身份；不能只改产物名 |
| `conversation.hero.frame` 与 `conversation.composer.frame` HOC | hero 层包装既有 scroll body，composer 层包装现有 chain 的 resident/takeover 输出；无层透传原子树，不替换草稿、回答通道或键盘处理。`hero` / `interactionKind` 仅为展示状态 | 保持直接 flex 布局、滚动/stacking、输入节点身份、焦点和卸载行为；审批、询问、plan-review 继续由原生 owner 执行 |
| `sidebar.right.frame` Session HOC | `active`、`expanded`、`fullscreen` 随已提交状态传递；无层直接渲染原 docking children；保留后台 Session 与 provider 实例 | 切 Session、keepMounted、浮动/停靠/全屏、焦点与关闭生命周期；展示层不得重建 tab 或绕过 provider |
| 输入卡与发送控件变量 | `--dsh-composer-card-radius/top-inset/row-gap` 默认原 panel radius、8px、12px；`--dsh-composer-submit-fill/hover/ink` 默认原 info fill/hover/白色；未设置完全沿用原行为 | 禁用/忙碌/hover 与主题对比、窄屏量测、菜单 portal 和真实提交；样式覆盖不接管输入业务 |
| 用户气泡、附件与工具摘要变量 | `--dsh-user-message-radius/inset` 默认 XL、`10px 16px`；`--dsh-attachment-preview-edge/card-radius/content-inset` 保留 64px、各 owner 原 radius、8px；`--dsh-tool-summary-font-size` 未设置保留原 font rule | `ui-primitives` / `ui-chat` / `ui-attachment` 的图片、文件、预览和删除路径；工具展开、结果/错误内容与执行仍由原组件拥有 |
| dockkit 展示变量 | pane/strip/active background 与 tab flex/min/max/padding/radius 均有原生 fallback：`0 1 auto`、80px、170px、`0 10px`、小圆角；28px 内容带与手势不变 | 实际浏览器 overflow 量测、拖动意图、窗口宽度和标题/关闭控件；原 controller 和 overflow reader 保持权威 |
| `llm-pi-ai/discovery-signal` 同步 waterfall | 无监听器保留原发现行为；在读取已存凭据之前捕获不可变 provider/endpoint/protocol，不传一次性 key。可拒绝托管草稿或组合取消 signal，无关草稿 next | 发现与推理两条路径均不得绕授权；取消组合、凭据读取先后、provider 原生 catalog 与个人路由仍可用 |
| `agent-default-model.saveSelection(next, expected?)` 条件写 | 不传 `expected` 保留原写语义；提供时在 profile 文件锁下比较完整当前选择，不匹配保留并发个人选择 | 文件锁内比较与写入原子性、旧调用兼容、空初始选择、账号切换/托管清理不能覆盖用户新选择 |
| 留存发布的可选 `source.distribution.artifactStem` | schema version 1 新字段从实际打包 manifest 提取；旧无字段明确使用旧命名空间，不借当前 checkout 身份；完成记录 URL 必须匹配 | 旧严格发布器需升级；Preview marker 缺失/错误不能把其 receipt 路由到旧 feed；保留禁 production/DeepSeek origin 与网站替换 |

桌面 packaging 声明中的 protocol 名称与 scheme 类型同时放宽为实际产品字符串，避免运行时已支持 UWork 而类型仍限定 `DeepSeek Harness` / `dsh`。这不是新增默认协议；值仍来自经过校验的产品元数据。

## 已执行的兼容检查

定向运行以下六个测试文件，全部通过，共 60 tests：

- `packages/client/ui-sidebar/tests/apply.client.spec.tsx`
- `packages/client/ui-sidebar/tests/panel-list.client.spec.tsx`
- `packages/llm/llm-pi-ai/tests/request-signal.spec.ts`
- `apps/desktop-host/tests/native-authorization.spec.ts`
- `apps/desktop-host/tests/product.spec.ts`
- `apps/desktop/tests/profile-bundles.spec.ts`

它们覆盖 HOC 注册与撤销后原生导航动作、未授权路由在凭据/网络前拒绝、无关路由 next 与 hook 撤销、进行中推理撤销、Host 请求重叠/取消/晚返回/退出收敛/安全错误、产品路径与 profile bundle 默认行为。发行侧另有打包、feed、上传计划及 namespace 定向验证，详见 [发行隔离 Agent Note](../.agents/notes/implemented/architecture/2026-11-10-uwork-preview-release-isolation.md)。

## 冲突关注点与仍缺证据

本轮没有观察到实际 merge-tree 冲突。将来优先审查共享 shell 返回结构、pi-ai dispatch/signal 组装、Desktop Main/Host 生命周期和上游打包/升级脚本；这些位置的语义变化即使能自动合并也需要上述测试复核。UWork 专属业务保持在独立插件包和产品 bundle，避免把企业业务规则继续塞入这些共享扩展面。

T40 的固定基线演练、共享 API 兼容记录和最终可达代码审计已完成。产品组合、持久化记录、locale 和构建分类通过本地门禁；正式产品版本与发行验收仍按主任务保留待办。

Windows x64 / Mac ARM 正式签名、公证、安装、连续版本更新、真实员工登录及授权推理仍需真实平台与凭据；Linux 源码测试和原仓库 Mac ad hoc workflow 不能替代。用户没有授权公网发布、上传或切换旧 feed，本次未执行这些操作。
