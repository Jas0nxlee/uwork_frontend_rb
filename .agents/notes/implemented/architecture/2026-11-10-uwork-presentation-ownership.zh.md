# Agent Note: 在原生 UI owner 上呈现 UWork

Status: implemented

[English](2026-11-10-uwork-presentation-ownership.md) | 中文

## 问题

UWork 产品需要自己的中性配色和紧凑导航，同时保留原生工作区、会话、输入框、键盘及移动端行为。替换侧栏插件还会替换其子席位声明与导航回调。

## 决策

[ui-uwork](../../../../packages/client/ui-uwork/README.zh.md) 安装一个随生命周期释放、包含浅暗配对值的 `theme.overrideTokens` 图层。它将源 UWork Zai 配色映射到现有语义角色，跟随浅色、暗色及系统偏好，并在卸载时恢复原配色。它不写入主题偏好，也不替换状态色、焦点指示或字体 owner。

原生侧栏仍是唯一的 `sidebar` owner，并声明 root 范围的 `sidebar.frame` HOC。frame 图层只接收 `collapsed`、`drawer` 和作为 `children` 的外壳。UWork 图层调整现有桌面展开态对齐变量；抽屉和折叠轨道保留原生几何。即使没有 frame 贡献，渲染器标准的 `display:contents` slot anchor 仍然存在。

品牌和首页资源继续使用原生品牌与 hero 席位。会话 frame 在阶段切换时保持挂载，使首页装饰可以消失而不替换输入框。原生 Agent presets、Session store、审批及工作台 presenter 继续由现有模块负责。

## 考虑过的替代方案

- 复制源侧栏或会话 store 会重复导航及会话的权威来源。
- 直接修改 DOM 主题会绕开原生主题偏好与图层生命周期。
- 引用侧栏私有 CSS 类会使产品耦合到实现名称，而不是现有对齐变量。

## 影响

产品呈现可以卸载，而不会移除原生导航 owner。复制的源品牌资源与配色保留原 Apache-2.0 notice。主题与导航切片不代表消息、审批或工作台页面族的完整迁移；它们需要各自的实际装配页面证据。
