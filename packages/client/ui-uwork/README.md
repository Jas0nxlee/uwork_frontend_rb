---
description: "UWork sidebar branding and blank-home artwork."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-uwork

English | [中文](README.zh.md)

## Summary

Display UWork artwork in the sidebar and UCAS decoration on the blank home. Marks follow the application ink in light and dark themes; leaving the home removes its decoration while retaining the composer.

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

- Only branding and home decoration are provided; navigation, modes, and the remaining page layouts are pending.
- Native installer icons, window menus, and enterprise sign-in are outside this package.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
