# UWork UI 迁移复核与实装证据

源基线为 `Jas0nxlee/UWork_frontend` 的 `f6dda23d7e6f39aa66804933b60f893d38ab6914`，对应[页面与状态基线](ui-baseline.md)。本记录描述当前组合的实施、保留原生行为的决定及证据边界，不以主题继承推定每页完成，也不以未复制源业务树推定展示没有实施。

## 实装的产品展示层

| 所有者 | 当前实现 | 原生所有权与保留差异 |
| --- | --- | --- |
| `client/ui-uwork` | 原 U/UWork/UCAS 资源接 sidebar 与 hero；20 组成对中性色通过 `theme.overrideTokens` 映射；`sidebar.frame` 在展开桌面态配置三项紧凑密度变量 | sidebar 保持唯一导航 owner，保留任务、workspace、折叠、touch drawer 和焦点。字体偏好、focus、状态色沿用原生；不把源主题整份 CSS 注入所有页面 |
| `client/ui-uwork-conversation` | 在 `conversation.hero.frame` 与 `conversation.composer.frame` 挂稳定 `display: contents` HOC。源消息表面映射浅 `#e6e6e6` / 暗 `#363636`、8px 圆角及 12×16px inset；输入卡 16px 圆角、12px top inset/row gap；附件 48px、8px 圆角和 4px 内部 inset；工具摘要采用内容字号。提交控件映射已有 primary/inverted 语义角色 | 不复制消息树、Session store、输入队列或请求分发。native streaming、reasoning、工具 disclosure、模型菜单、附件 lightbox、草稿、resize、失败和停止机制继续生效。源独立 status-panel 的平移/宽度规则不复制，保留目标可调内容宽度轴 |
| `client/ui-uwork-interactions` | 同一 `conversation.composer.frame` 的独立 HOC 按 `approval` / `question` / `plan-review` 作用域应用源 rounded-2xl 的 16px 卡片圆角、popover surface 和轻 elevation；普通及 pending 切换保持 wrapper 身份 | 不强抢 composer chain、不添加决策监听器、不重写问题草稿。原生 warning strip、拒绝/允许、请求失效、键盘、重试、滚动上限和原有动作顺序保留。常驻输入和焦点不因交互类型变化被替换 |
| `client/ui-uwork-workbench` | 在 `sidebar.right.frame` 挂 Session 作用域 HOC，配置 Dockkit 表面和 tab 样式；源等宽 tab basis 156px、下限 60px、上限 156px，保留 28px 内容带及 8px 圆角 | `ui-sidebar-right` 拥有 retained Sessions/资源路由，`ui-dockkit` 拥有测量、selection、close、drag、split、float 和 focus。文件、浏览器、终端及文档 provider 保持各自读写与生命周期策略；Office 不增加编辑入口 |

这些层均使用 owner 支持的 slot/样式变量；没有选择其他业务包的内部 class，也没有复制旧 RPC、Session、任务列表或 tab store。普通产品不装这些可选层时保留原 fallback。相关变量的合同分别维护在 Conversation、primitive、chat、attachment、tool、rightbar 和 Dockkit 的包文档中。

## 已执行的组件与真实页面证据

| 切片 | 证据入口 | 已覆盖与限制 |
| --- | --- | --- |
| 品牌/导航 | `ui-uwork/tests/brand.client.spec.tsx`；`apps/web/tests/uwork-brand.e2e.ts`；sidebar 的 apply/panel-list 等回归 | effect-owned 挂载/撤销、声明先后、唯一 native owner、撤销后动作仍有效；不能由此替代双平台窗口 chrome 检查 |
| 对话/输入/附件/工具 | `ui-uwork-conversation/tests`；`apps/web/tests/uwork-conversation.e2e.ts`；成功截图 `run-BYAQHZ/` 与 `running-hNKiAr/`，均在 `.artifacts/uwork-conversation` 下 | 2026-11-10 14:46:43 起整文件 2/2 PASS（17.20s）；UI 插件自身 4 tests、源码四维 100%。第一场景有 7 图：浅暗 × 1280/760/390 + dark-message-tool；第二场景有 3 图：`light-stop.png`（1280）、`dark-stop.png`（390）、`dark-queued.png`（390）。覆盖真实录制的 50-tool-result 会话/工具展开、native 模型菜单键盘选项、长草稿、TXT/PNG 真实上传与删除、48px 附件/8px bubble/16px 输入；真实 hang replay→Queue 入队/移除→键盘停止，验证 submit fill/ink、disabled/hover。未另落 shell 日志，以 owner 成功工具输出登记 |
| 审批/普通询问 | `ui-uwork-interactions/tests/frame.client.spec.tsx`；`apps/web/tests/uwork-interactions.e2e.ts`；日志 `/workspace/scratch/uwork-interactions-browser7.log` | 新包 8 tests、source 100%；共享 skeleton 40 tests保护常驻 composer；实际 Web 2/2 场景通过，显式从 native 菜单选择 fixture 模型，执行真实 pending approval/question、允许、Blue+custom 回答、模型 turn 完成及完整持久化回放 |
| 交互视觉 | `.artifacts/uwork-interactions/{approval,question}-{light,dark}-{1280,390}.png` 共八张成功截图 | 实际检查宽窄、浅暗代表图；长审批内容保留滚动，card radius 16px、popover 色、视口边界与所有 footer 动作自动断言通过。不是 isolated mock 页面；模型回复回放，用户动作与 Host/Client 组合真实执行 |
| 工作台 | `ui-uwork-workbench/tests`；`apps/web/tests/uwork-workbench.e2e.ts`；最终成功截图 `.artifacts/uwork-workbench/run-GUxQ1a/` 共 16 张 | 2026-11-10 15:31:54 起 replay 1/1 PASS（总时长 17.47s，test 15.34s）；UI 自身 5 tests、源码四维 100%。覆盖原有长名 preview、Browser、split、close、实际拖动 float，并新增真实 Linux bash PTY 的 `printf`/`pwd`、Files 往返同一 spawn/PID、1680/390 浅暗保留输出及关闭后 PID 退出；真实 XLSX 经 spreadsheet Worker 只读展示、拒绝单元格键入且源 bytes 不变；真实 DOCX 经 LibreOfficeKit multipart PDF 与 PDF Worker 显示中文，无 contenteditable 且源 bytes 不变。Browser 外部 HTTPS 文档为 synthetic；结果不涵盖 Office 编辑、其他格式或 Windows/Mac carrier。以 owner 最终成功工具输出登记 |

对话与工作台证据路径、时间及通过数由各 owner 的最终成功工具输出确认；早期 conversation `run-BPSDAq` / `running-TwGRzb` 与早期 workbench `run-TdANGn` / `run-onf5t7` 均不作为上述最终记录。

交互场景保留原生完整回放比较。由于 UWork 产品初始没有 preferred model，用户需显式选择；临时 expected fixture 只补入这个已知 `model/selection` 事件，并精确平移 v4 的 title/tool-result eventSeq 引用，未关闭 comparison，也未修改原 fixture。临时目录、浏览器与 scaffold 均由测试收尾释放。

## T19–T22 的当前判断

### T19 品牌、主题与首页

品牌和基础色板不是占位，已装进产品组合。首页继续采用 dsh 原生 workspace/preset 与常驻输入；这是一项适配决定，源 `WelcomeScreen` 登录页与空白任务 hero 仍是不同状态，不能用同一图替代。控件、菜单、弹窗使用共享 semantic role 和原有 status/focus 所有者；保留状态语义是受支持行为，不要求为每页再复制一套 presenter。

仍需补源实际页面截图及逐状态对照，记录对比/焦点、长 workspace/preset 名、窄窗和装饰背景关系。中性色覆盖不直接证明所有错误/禁用/空态的视觉已验收。

### T20 导航与布局

唯一 layout/sidebar owner 与紧凑展示已实现；源 `WorkspaceSidebar.tsx` 实际 re-export `project-sidebar/index.tsx`，源审查应以真实 owner 为准。目标保留 dsh 任务和多面板恢复模型，源项目/任务 store 不迁入。已有 sidebar 生命周期和动作证据可以复用，不需要对每个导航入口复制相同折叠逻辑。

长任务名、搜索无结果、重命名/归档、多个 workspace、drawer 和多面板恢复仍要按基线记录组合证据。Windows 系统按钮、拖拽区与 Mac traffic lights/全屏属于实际安装候选检查，Linux Web 截图不能证明它们完成。

### T21 对话、交互与工作台

三块新展示包已实际注册，不再是“未有 presenter”。消息/输入/附件/工具摘要由受支持变量调整，审批/询问由 HOC 调整表面，工作台由 native frame/Dockkit 调整 tab；原生状态机和动作均保留。无需逐页重写 streaming、工具结果、模型请求、草稿、权限和资源 provider，因为这些所有者继续提供当前产品支持的行为，针对相同实现可复用既有回归，并用新产品组合测试确认展示没有遮挡其动作。

差异保留明确：不复制源 status-panel 平移规则、旧任务/RPC 树、独立 browser/terminal 引擎或文档编辑器；保留目标可调内容宽度、native menu/focus、retained tab 和各 provider 策略。Office 保持只读。

尚未由新交互浏览器场景直接覆盖的是计划审查的长 Markdown 布局、中文交互文案，以及实际应用中的过期/回答失败状态；原生单元/组件测试可证明 settlement/retry 机制，但不能冒称这些 distinct 页面已经查看。工作台现已有 Linux 真实 PTY 输入、保留与退出，以及 XLSX/DOCX 只读 provider 链路证据。Office 编辑和其他格式不由这些结果推定；Desktop resident guest 与 Windows/Mac provider 行为仍需对应平台证据。

### T22 设置与全局状态

企业账号、托管模型、公司市场和企业用量已由各自插件贡献；通用设置 shell、个人 provider、语言与主题偏好继续使用唯一 native owner。企业用量选择 `main` + `sidebar.panellist` 独立入口，相对原基线 `settings.section` 是明确导航适配，需要在最终路径记录中体现。

通用按钮、菜单、卡片可复用其 native 行为/locale 测试和语义角色；账号代际、模型确认、用量缓存/未知单位、公司安装事务等独特内容则必须有各自 owner 场景，不能以品牌或交互卡片截图替代。完整串行路径仍为首页→任务→对话/工作台→设置/企业模型→市场→用量→原任务，并检查草稿、选择和 pane 恢复。

## 仍未验收的边界

- 源实际页面截图、逐页中英/浅暗/长内容的完整矩阵，以及上面明确列出的 distinct 交互与错误布局；已有 owner 证据只在同实现、同布局/状态成立时复用。
- Windows x64 与 Mac ARM 的原生标题栏、实际安装、权限、native helpers、退出及连续签名更新。已完成的 Linux 真实 PTY、XLSX/DOCX provider 检查及合成原生授权 smoke 不替代它们；Office 编辑与其他格式也不在上述已验收范围内。
- 真实员工登录、授权模型推理、切换账号与企业用量对账。公开发现和 synthetic issuer/replay fixture 不能替代真实身份验收。

本记录不单独勾选全部 T19–T22 或 T38；它把已实施的切片、受支持的原生保留差异、已执行证据和仍缺场景分开记录，供 root 汇总最终门禁与任务状态。
