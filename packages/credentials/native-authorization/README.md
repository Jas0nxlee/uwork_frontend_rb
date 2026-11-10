---
description: "Private product-selected native authorization provider registry."
kind: "package-reference"
---

# @deepseek-ai/dsh-native-authorization

English | [中文](README.zh.md)

## Summary

`ctx.nativeAuthorization` selects the product's native sign-in provider. Product composition loads this service before the identity provider, which registers its implementation through `register()` and withdraws it with the returned disposer. A second provider is rejected. Without a registered provider Desktop keeps the standard account Welcome.

## Table of Contents

- [Use This Package](#use-this-package)
- [Understand the Implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use This Package

Load this service before the product identity provider. The provider registers through an effect-owned `register()` call. The private Desktop Host bridge obtains the selected implementation with `getProvider()`; ordinary products may omit the service entirely. After committing a safe state, the identity provider emits `native-authorization/changed(state)`. Desktop subscribes to this neutral event rather than any business identity service.

The provider owns credential storage, session verification, attempt generations, expiry and cancellation. `getState`, `poll`, `cancel` and successful `complete` return token-free display state. `start` returns private navigation only to the Desktop Host/Main bridge. Callback URLs and authorization codes never pass through application renderer IPC. Cancelling must settle owned work and prevent late results from restoring a withdrawn credential.

## Understand the Implementation

The Desktop consumer owns its sandboxed temporary browser, sender admission, navigation policy and resource teardown. This package has no Remote methods and no Electron dependency.

## Further Exploration

- [Desktop](../../../apps/desktop/README.md)
- [Enterprise identity](../uwork-enterprise/README.md)
- [Authorization ownership decision](../../../.agents/notes/implemented/architecture/2026-11-10-native-product-authorization.md)

## Model Experience

None, as this service only connects native authorization surfaces to a product identity provider and adds no model input or tool.

#### KV Cache effect

This service does not change prompts, model requests, message order or cache keys.

## Known Limitations and Deferred Work

- The registry does not implement an identity protocol or credential transaction. The provider must reject late results after cancellation.
- Real employee authorization and native Windows x64/Mac ARM acceptance require their corresponding devices and services.

### Dev Note

The focused registry test checks absent selection, duplicate rejection and lifetime withdrawal. Desktop owns real browser lifecycle evidence.

The Desktop profile test has an opt-in public WeCom empty-flow probe: set `DSH_WECOM_LIVE=1` and run `apps/desktop/tests/uwork-profile.e2e.ts` with `vitest.e2e.config.ts`, a desktop display and built artifacts. If the environment requires a proxy, explicitly pass its URL through `DSH_WECOM_PROXY`; the shared test setup clears ambient proxy variables. The probe starts the real Host handoff, opens the production isolated Electron carrier, captures safe page evidence under `.artifacts/wecom-live`, and cancels without scanning or authenticating. It uses temporary profile roots and retains certificate and sandbox checks. A successful handoff alone does not establish QR availability: an issuer network failure remains a failed live probe.

The 2026-11-10 Linux live probe is partial evidence: the real Beijing Host handoff started successfully (HTTP 201), but the production carrier could not tunnel to `login.work.weixin.qq.com` (`ERR_TUNNEL_CONNECTION_FAILED`), also reproduced by independent Node networking. No QR was rendered. Carrier disposal, Host cancellation and the signed-out state assertion completed; no authentication occurred. The opt-in network failure is separate from the passing default offline profile regression.
