---
kind: upgrade-guide
description: "Sidebar closeTarget can report pending while an editor prepares to remove its tab."
---

# Deferred sidebar close decisions

English | [中文](guide.zh.md)

## Change

`SidebarRightController.closeTarget` adds a `pending` result when the tab kind registers a close guard. Pending means a save/discard decision is still running, not that the tab was removed. Unguarded tabs keep their synchronous behavior.

Editor plugins can register `registerCloseGuard(kind, { prepare, failed })`. Existing `registerCloseHandler` callbacks remain synchronous cleanup after approval; they are not async save hooks. Batch menu closing stops at the first refused decision.

## Migration

1. Update exhaustive consumers of `closeTarget` results to handle `pending` without treating it as confirmed removal or closing the native window.
2. Use `requestCloseIn(sessionId, tabId)` when the caller needs to await confirmation. A false result retains the tab.
3. Register editor guards through effects, withdraw interactions on their abort signal, and present failures from the synchronous non-throwing `failed` callback.
4. Keep application-exit and plugin-unload preflight separate. These tab guards do not prevent forced termination; persist recovery drafts before it.
