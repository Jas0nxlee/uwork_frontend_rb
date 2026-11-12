---
description: "UWork surfaces around native approval and question composers."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-uwork-interactions

English | [中文](README.zh.md)

## Summary

Apply UWork interaction surfaces to native approval, question and plan-review takeovers. The native owners retain decisions, request lifetimes, keyboard handling, answer retries and question drafts.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Select this optional presentation after the native Conversation and interaction packages. It contributes only to `conversation.composer.frame`; it does not replace a chain entry or register another decision listener. Unloading withdraws its contribution.

<a id="understand-the-implementation"></a>
## Understand the implementation

The root-scoped HOC receives the generic `interactionKind` and unchanged native children. A stable layout-neutral wrapper remains for ordinary and pending states, so changing the interaction discriminator does not remount the resident input. Only approval, question and plan-review apply interaction roles. Unrelated interactions retain native appearance.

The source UWork `PermissionDialog.tsx` and `ElicitationDialog.tsx` use rounded-2xl popover cards and a small shadow. This adaptation scopes a 16px card radius, semantic popover surface and compact elevation using the theme’s level-one shadow to the native composer seat. It preserves warning colors, focus indicators, scrolling limits, action order and native controls. Light and dark surfaces follow the application semantic palette. It does not import the source RPC, store, option semantics or modal lifetime.

<a id="model-experience"></a>
## Model Experience

None, as this package changes only native interaction presentation and never constructs model messages, schemas or tool results.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Plan-review layout, Chinese copy, and application-level failure/expired states still need distinct rendered inspection; this slice does not establish full T21/T22 or desktop platform acceptance.

### Dev Note

Tests exercise native approval allow/reject/Escape and retry through the product wrapper, stable resident editor identity across takeover changes, and declaration-late attachment and withdrawal. The shared Conversation skeleton retains its existing resident-composer checks. The browser scenario selects the fixture model through native UI, preserves full replay comparison with the one explicit selection event, and captures the assembled page.

The actual Web composition is checked through replayed native approval and question requests in light/dark at 1280px and 390px, including long approval content, reachable footer actions, submission and exact persisted replay.
