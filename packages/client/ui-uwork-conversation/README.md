---
description: "UWork presentation over native conversation controls."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-uwork-conversation

English | [中文](README.zh.md)

## Summary

UWork presentation for native messages, tool summaries, attachments and the resident composer. The plugin composes transparent Hoc layers with existing branding and approval/question layers; it preserves native rendering, model selection, drafts, queueing, upload controls and Session behavior.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known limitations and deferred work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use This Package

Load only in the UWork product layer after `ui-renderer`, `ui-conversation` and `ui-theme`. The package contributes fresh `uwork-conversation` and `uwork-composer` layer IDs to `conversation.hero.frame` and `conversation.composer.frame`. Both use `display: contents`, render their existing children exactly once, and retain component identity when home or interaction state changes. Disposing the plugin withdraws its layers and palette override.

<a id="understand-the-implementation"></a>
## Understand the Implementation

The source references are UWork's `components/ai-elements/message.tsx`, `prompt-editor/ChatPromptEditor.tsx`, `v4/ConversationComposer.tsx` and `ToolCallBlocks/ToolSummaryRow.tsx`. The source Zai palette supplies user-message fills `#e6e6e6` in light mode and `#363636` in dark mode through the native theme override API.

Owner-supported CSS variables apply an 8px user-message radius with 12×16px insets, a 16px composer radius with 12px top inset and row gap, 48px attachment previews with 8px radii, and body-sized tool summary text. File-card inner vertical padding becomes 4px so its filename and metadata remain inside the smaller preview height. Every owner retains its original fallback when the plugin is absent. Submit controls use the existing primary fill/hover and inverted text roles while native disabled, loading and stop states remain unchanged. The plugin uses no selectors into business-owned DOM and adds no global stylesheet or copied render tree.

The original native content-width controls, typography preference, menus, focus behavior, lightbox, tool disclosure, streaming states and error treatments remain active. The target's resizable width axis is retained instead of copying the source's status-panel width and translation rules.

<a id="model-experience"></a>
## Model Experience

None, as this plugin changes presentation without adding model input, tools or Session events.

#### KV Cache effect

The plugin does not change requests, message order, retained history or cache keys.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Source product typography and compact attachment geometry are applied through native components. Source-specific status-panel translations and a separate conversation business tree are not reproduced; native resize and composition behavior remain authoritative.

### Dev Note

Geometry variables live with their component owners. Extend those documented variables when another source treatment is required; do not select another plugin's internal classes or replace its stateful controls.
