---
description: 'Enterprise gateway protocol and bounded Host transport'
kind: "package-reference"
---

# @deepseek-ai/dsh-uwork-gateway

English | [中文](README.zh.md)

## Summary

Host-only enterprise gateway protocol reference. Construct a client inside `uworkIdentity.withSession`; the identity owner checks the generation before returning. The client retains no cache and never refreshes identity credentials.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

Mounting this package as a plugin with `origins` and `ecdhCurve` applies a TLS key-exchange preference only to those exact HTTPS origins. Other destinations use the existing dispatcher. Proxy routing follows the launch environment, and unloading restores the previous dispatcher. The UWork bundle selects `X25519:prime256v1` for its enterprise issuer to support TLS 1.3 without hybrid key shares.

The caller resolves `apiBaseUrl`, exact deployment `allowedModelEndpointOrigins`, `timeoutMs`, `maxResponseBytes` and `maxItems`. The control address must be a configured HTTPS origin. DNS syntax is not proof of public routing; the model endpoint must match the deployment origin allowlist. Requests reject redirects and transmit the identity bearer only to that origin. Responses have bounded bytes and collection lengths. Cancellation, timeout, authentication, authorization, rate limiting, transport and invalid data remain distinct failures.

Usage preserves server accounting amounts with an unspecified unit; success rates become fractions. Missing or failed aggregates never become zero. Only the public `llm_base_url` is exposed. A bare origin uses `/v1`; an explicit path is retained. Internal endpoint fields are discarded.

Key secrets are Host-only return values. Generation makes exactly one request. Network errors, server failures and invalid successful responses leave an unknown mutation outcome; callers must persist an intent and reconcile by alias before another generation attempt.

## Understand the implementation

The transport bounds streaming bodies and response collections, keeps control-plane and model API bearers separate, and parses only supported protocol fields.

## Model Experience

None, as this package adds no tools, model messages or session content.

#### KV Cache effect

This package does not change model request prefixes.

## Known Limitations and Deferred Work

- Authenticated wire examples are synthetic because no employee test identity is available. This package does not orchestrate provisioning, persist key-generation intents or project secrets to the Client.
### Dev Note

Run the owner-local protocol tests with Vitest. Identity refresh belongs to the identity owner because the upstream refresh endpoint rotates its bearer.
