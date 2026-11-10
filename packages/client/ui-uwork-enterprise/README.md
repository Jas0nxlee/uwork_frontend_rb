---
description: "Safe UWork enterprise account presentation in native settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-uwork-enterprise

English | [中文](README.zh.md)

<a id="summary"></a>
## Summary

Show the verified enterprise account, public organization labels, managed-model status, refresh, and sign-out in the native settings panel. The Host owns credentials and issuer validation; this package receives only the safe generated identity projection.

## Table of Contents

- [Use this package](#use-this-package)
- [Implementation](#implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Compose the [UWork desktop bundle](../../bundle/uwork-desktop/README.md). Open Enterprise account in Settings. To switch organizations, sign out and select the organization in the native sign-in window. This package has no configuration fields.

<a id="implementation"></a>
## Implementation

The generated `uworkIdentity` Remote exposes only `getState`, `listOrganizations`, `signOut`, and the safe `watchState` stream. Standard `useResource` hooks read account and model providers. The account provider watches safe identity changes across windows. Resource addresses include the native connection generation, so disconnect or Host replacement clears previous account and model facts immediately, and reconnect opens a fresh stream. Resource ownership supplies sharing, cancellation, and obsolete-frame rejection; the private store contains only mutation interaction state.

A resource-stream failure can retain previous details with an explicit verification failure; explicit refresh opens a new resource generation. A failed or uncertain sign-out retains the account projection and asks for refresh; it never assumes the credential was removed. Diagnostics, credential values, authorization URLs, and callback data are not rendered. The native Main process owns returning to sign-in after logout.

Model reads use only the safe non-creating refresh method. Creating a managed key requires a dedicated dialog explaining server-side creation and a separate confirmation button. No mount, reconnect, refresh, or retry creates a key. An uncertain creation outcome blocks another creation attempt until a fresh post-completion read from the same connection and account verifies ready models or missing capabilities. Ready state lists the published models and asks users to choose a default only when the Host reports that one is missing.

<a id="further-exploration"></a>
## Further Exploration

- [Enterprise identity](../../credentials/uwork-enterprise/README.md)
- [Settings](../ui-settings/README.md)
- [UWork presentation](../ui-uwork/README.md)

<a id="model-experience"></a>
## Model Experience

None, as account presentation adds no model input.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Native authorization and its embedded browser belong to Desktop, not this settings page.
- The native sign-in window owns organization switching; this settings page exposes no authorization URL or callback controls.

<a id="dev-note"></a>
### Dev Note

The resource model owns live read lifetimes. Identity mutation calls have no transport-cancellation argument; managed-key creation uses the generated cancellation signal and retains the Host’s uncertain-outcome protection.
