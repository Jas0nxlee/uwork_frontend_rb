---
description: "在原生保留式标签与停靠界面上提供 UWork 工作台展示。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-uwork-workbench

[English](README.md) | 中文

## 概述

将 UWork 标签栏展示应用到原生工作台。文件、浏览器页面、终端和文档预览继续使用现有标签提供者、保留式 Session 拥有者与停靠控制器。产品不增加平行标签存储或查看器。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用此包

在产品 bundle 的 `ui-sidebar-right` 之后加载此包。它通过 Session 范围的 `sidebar.right.frame` HOC 挂接，普通产品不加载。Host 入口不执行操作。没有 frame 注册者时，原生 rightbar 渲染原有子树，Dockkit 使用未改变的 CSS 回退值。

产品框架继承应用的明暗主题语义颜色。标签等宽基准为 156px，最小 60px、最大 156px；保留原生 28px 内容带、8px 圆角 token、关闭控件及键盘焦点提示。这些几何值来自[源前端](https://github.com/Jas0nxlee/UWork_frontend)的 `packages/ui/src/app-shell/SidePaneTabTrigger.tsx`。

<a id="understand-the-implementation"></a>

## 理解实现

`WorkbenchFrame` 使用 `display: contents`，因此不创建包含块、层叠上下文或替代停靠根。它限定 [Dockkit 展示变量](../ui-dockkit/README.zh.md#embedding-it)的作用范围。rightbar 提供已提交的 `active`、`expanded` 和 `fullscreen` 状态；框架不改变状态、处理器、标签身份或子节点 key。

`ui-sidebar-right` 继续负责保留式 Session、各标签生命周期及资源路由。`ui-dockkit` 负责焦点、标签选择、溢出测量、关闭手势、拖动、浮窗及分屏几何。文档、代码、Office、终端与浏览器提供者保留各自的读取和编辑策略。框架不会将只读预览变成编辑器。

<a id="further-exploration"></a>

## 进一步探索

- [右侧栏](../ui-sidebar-right/README.zh.md)
- [Dockkit](../ui-dockkit/README.zh.md)
- [UWork 产品主题](../ui-uwork/README.zh.md)

<a id="model-experience"></a>

## 模型体验

无，因为工作台展示不提供模型输入或工具。

#### KV 缓存影响

此包不改变提示词、消息、模型请求或缓存键。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 此包改变原生标签栏及界面展示，不移植源应用的标签存储、终端引擎、浏览器引擎或文档编辑器。
- 真实提供者验收覆盖 Linux bash PTY、只读 XLSX 及 DOCX 预览，不代表 Office 编辑、其他文档格式或 Windows/macOS 终端行为已验收。Web Browser 保留导航，并按原有策略在隐藏后重新挂载；Desktop 保留现有常驻载体策略。

<a id="dev-note"></a>

### 开发备注

真实 Web 组合测试打开带长文件名的只读工作区预览及标准 Browser 提供者，只有外部 HTTPS 文档使用合成内容。测试检查 1680px、760px 和 390px 下的明暗主题、原生分屏及关闭控件和浮动 Browser 文档。

Linux 场景还通过真实 bash PTY 执行无副作用的 `printf` 和 `pwd`，检查切换标签及 1680px/390px 明暗主题时进程与输出保留，并确认关闭后进程退出。真实 XLSX 字节经过电子表格 Worker 渲染且不接受单元格编辑。真实 DOCX 字节经过现有 LibreOfficeKit 转 PDF 端点及 PDF Worker 显示中文文本；两种预览均不改变源文件字节。

针对性测试覆盖 effect 拥有的注册与撤销、已提交框架状态、展示变化中的输入及焦点保留，以及文件、浏览器、终端和文档标签类型的原生选择、分屏、浮窗和关闭。共享 rightbar 与 Dockkit 回归测试保护未定制行为。构建产物后运行 `node_modules/.bin/vitest run --config vitest.web.config.ts --maxWorkers=1 apps/web/tests/uwork-workbench.e2e.ts`，执行真实页面回归及其拥有者本地的无障碍快照检查。
