---
description: "UWork sidebar branding and blank-home artwork."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-uwork

English | [中文](README.zh.md)

## Summary

Display UWork artwork in the sidebar and UCAS decoration on the blank home. Marks follow the application ink in light and dark themes; leaving the home removes its decoration while retaining the composer.

The source UWork neutral light/dark palettes apply through the native theme service to the application, sidebar, composer, and navigation states. Existing theme preferences, status colors, focus indicators, font settings, and native agent presets retain their owners.

Expanded desktop navigation uses a compact presentation through `sidebar.frame`. The native sidebar still owns actions, collapse, focus, and workspace/session state; the mobile drawer and collapsed rail keep their original geometry.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Compose the [UWork bundle](../../bundle/uwork-desktop/README.md) to withdraw the default brand occupants at the same time. This plugin has no configuration fields.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

Standard slots own each contribution and release it with the locale dictionary on unload. Asset masks inherit semantic theme ink. Source UWork artwork retains its Apache-2.0 license and source notice.

One lifecycle-owned `theme.overrideTokens` layer maps the source Zai palettes to semantic roles. It follows light/dark/system changes without writing a preference; unloading restores the underlying palette.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Sidebar](../ui-sidebar/README.md)
- [Conversation](../ui-conversation/README.md)
- [Theme](../ui-theme/README.md)

<a id="model-experience"></a>
## Model Experience

None, as brand presentation adds no model input.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This package owns brand, home decoration, neutral theme roles, and compact desktop navigation. Conversation, interaction, and workbench geometry belong to their dedicated UWork presentation packages.
- Native installer icons, window menus, and enterprise sign-in are outside this package.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
