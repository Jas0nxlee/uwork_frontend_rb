---
description: 'Safe enterprise account and usage projections'
kind: "package-reference"
---

# @deepseek-ai/dsh-uwork-gateway-service

English | [中文](README.zh.md)

## Summary

Host service reference for safe enterprise gateway account and usage reads. Mount after `uworkIdentity`; `ctx.uworkGateway` supplies masked overview records and validated aggregate statistics through Remote methods.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

Configure the control-plane `apiBaseUrl`, exact deployment `allowedModelEndpointOrigins`, request `timeoutMs`, `maxResponseBytes`, `maxItems` and successful-read `cacheTtlMs`. Requests run inside the identity owner's generation-scoped Host callback. Overview contains the verified user’s display name, the configured organization label, the public endpoint, masked key metadata, subscriptions and explicit authorized-model restrictions; it never reveals or generates keys.

Usage caches are separated by organization, user, generation, period and metric. Identity changes clear cached observations. A newer usage selection cancels the older selection. Expired reads may retain a same-identity, same-selection `lastSuccess` with its observation time when a refresh fails. Signed-out states issue no requests and carry no aggregate values. Errors never become fabricated zeros.

## Understand the implementation

Failed gateway reads also return through the identity callback so its final generation check runs before any last successful value becomes visible. Identity notifications invalidate cached observations and cancel obsolete work.

## Model Experience

None, as this package adds no tools, model messages or session content.

#### KV Cache effect

This package does not change model request prefixes.

## Known Limitations and Deferred Work

- Authenticated fixtures are synthetic. Usage cost and subscription amount units remain unspecified by the observed protocol. Successful observations are memory-only and cleared on service disposal.
### Dev Note

Tests compose real identity and file-backed credential services against a synthetic external issuer and gateway. The Loader case verifies service activation through configuration.
