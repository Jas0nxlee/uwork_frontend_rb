---
description: "UWork branding, enterprise identity, managed model routes, usage and public company skills for a desktop profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-uwork-desktop

English | [中文](README.zh.md)

## Summary

Compose UWork presentation, native enterprise sign-in, managed model routes, enterprise account and usage, and verified PUBLIC company skills over the native dsh surface; withdraw the default whale layer. Apply after the base and Web bundles; this fork's Desktop product configuration includes the layer in initialization, packaging and recovery.

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

The patch disables ui-brand-official and inserts UWork branding, the anonymous company catalog and its Plugins tab. Catalog browsing and installation require no enterprise identity; enabled installations contribute through the native skill provider. Native authorization and enterprise identity own sign-in and Host-only credentials. The gateway service uses the Host protocol client for safe account and usage projections. Managed provisioning installs explicit enterprise routes through native llm-pi-ai while preserving personal providers and defaults. The release declares each UCAS model’s context window, text/image inputs and reasoning levels from the UWork catalog; request output is capped at 32,768 tokens independently of the model’s published output ceiling. GPT and GLM use 1,000,000-token context windows; DeepSeek and Kimi use 1,048,576. GLM accepts text only; the other five configured models also accept images. GPT offers low, medium, high, xhigh and max; the others offer low, high and max. GLM and DeepSeek send both `thinking.type: enabled` and `reasoning_effort`; GPT and Kimi send `reasoning_effort`. The first preferred authorized model is selected when no default is set. The enterprise account and usage UI render those safe projections; earlier layers retain Sessions, permissions and the workbench. Conversation, interaction and workbench presentation use native owner extension points without duplicating Session, composer decision or pane state. Later profile patches can override these rows. The UWork composition disables the bundled DeepSeek API-key and account providers. Its managed provider is read-only in Models settings; enterprise synchronization owns all updates.

Enterprise organization and callback allowlists come from the public UWork release configuration. They contain no session tokens or model keys. Real authenticated capability verification and formal desktop acceptance remain separate from this composition.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Profiles](../../boot/app-boot/README.md)
- [UWork](../../client/ui-uwork/README.md)
- [Enterprise identity](../../credentials/uwork-enterprise/README.md)
- [Native authorization](../../credentials/native-authorization/README.md)
- [Gateway service](../../boot/uwork-gateway-service/README.md)
- [Managed model provisioning](../../llm/uwork-model-provisioning/README.md)
- [Conversation presentation](../../client/ui-uwork-conversation/README.md)
- [Native interaction presentation](../../client/ui-uwork-interactions/README.md)
- [Native workbench presentation](../../client/ui-uwork-workbench/README.md)
- [Enterprise account UI](../../client/ui-uwork-enterprise/README.md)
- [Enterprise usage UI](../../client/ui-uwork-usage/README.md)
- [Company catalog](../../boot/uwork-company-market/README.md)
- [Web](../web-app/README.md)

<a id="model-experience"></a>
## Model Experience

Indirectly, through enabled company skills rendered by `dsh-tool-skill` and managed enterprise selections rendered by native `llm-pi-ai`; branding, sign-in, account presentation and usage reads add no model input.

#### KV Cache effect

Changes to enabled company skills can append a replacement skill catalog on later model requests. Provisioning does not rewrite Session selections or existing request prefixes; subsequent selection and adapter behavior own the actual model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Real employee login, authorized gateway inference, account switching and usage accounting remain unverified without an authenticated test identity. Public discovery and synthetic fixtures do not replace that evidence.
- Signed Windows x64 and Mac ARM installers and their native acceptance remain pending.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
