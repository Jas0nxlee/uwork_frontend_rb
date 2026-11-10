---
description: "UWork brand presentation for a desktop profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-uwork-desktop

English | [中文](README.zh.md)

## Summary

Add UWork sidebar and home branding to the dsh Web surface and withdraw the default whale layer. Apply after the base and Web bundles; this fork's Desktop product configuration includes the layer in initialization, packaging and recovery.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The local profile must resolve this bundle and its dependencies. Configure its package.json in this order:
```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@deepseek-ai/dsh-uwork-desktop"
      ]
    }
  }
}
```

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

The patch disables ui-brand-official and inserts ui-uwork. Earlier layers continue to own models, Sessions, permissions, and the workbench; later profile patches can override these rows.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Profiles](../../boot/app-boot/README.md)
- [UWork](../../client/ui-uwork/README.md)
- [Web](../web-app/README.md)

<a id="model-experience"></a>
## Model Experience

None, as brand presentation adds no model input.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This layer currently provides branding; enterprise identity, company market, and enterprise gateway usage are not yet composed.
- Signed Windows x64 and Mac ARM installers and their native acceptance remain pending.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
