---
description: "公开公司技能浏览与安装管理"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-uwork-company-market

[English](README.md) | 中文

## 概述

在插件页浏览、安装、更新和管理公开公司技能。[UWork bundle](../../bundle/uwork-desktop/README.zh.md)同时装配本标签页及其[目录 Host](../../boot/uwork-company-market/README.zh.md)。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

公司市场标签页使用 `plugins.tab`，没有配置字段。输入并提交搜索、切换结果页，或刷新当前请求。无需企业登录即可查看来源、规范 slug、摘要和发布版本。Host 具备 profile 自有存储时，可安装或更新准确发布版本，并独立于目录管理已安装技能。即使技能从公开目录消失，仍可启用、停用、卸载和刷新；仅目录浏览的 Host 显示安装不可用。

<a id="understand-the-implementation"></a>
## 实现说明

根级控制器跨标签页挂载保留查询及最近结果。新查询取消旧调用，迟到结果不能覆盖新查询。失败保留旧行并显示提示与重试动作，翻页等待成功结果。卸载会取消请求、释放标签页和词典，并移除生成的 Remote 命名空间。管理操作串行写入，并在成功、拒绝或确认丢失后重新读取持久列表。读取失败保留旧行并阻止写入，直到成功刷新；结果未知和已提交分别提示。文案提供八种应用语言，控件和卡片使用共享组件及主题 token。

<a id="further-exploration"></a>
## 延伸阅读

- [目录 Host](../../boot/uwork-company-market/README.zh.md)
- [插件插槽](../ui-plugin-manager/README.zh.md)
- [主题](../ui-theme/README.zh.md)

<a id="model-experience"></a>
## 模型体验

无，公开目录展示不增加模型输入。

#### KV Cache effect

无。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 安装需要 profile 自有存储或显式 Host 安装目录。
- 完整性失败与事务结果未知会明确显示，不渲染上游诊断。
- 不支持私有市场认证或编辑内置来源。

<a id="dev-note"></a>
### 开发备注

本标签页不会把 SkillHub 内容交给插件页的 npm 安装器。
