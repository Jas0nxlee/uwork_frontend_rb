---
description: "Enterprise identity grants and cancellable Host capabilities."
kind: "package-reference"
---

# @deepseek-ai/dsh-uwork-enterprise

English | [中文](README.zh.md)

## Summary

`ctx.uworkIdentity` owns enterprise authentication independently of the DeepSeek account. It registers a native sign-in provider and an authorization flow, persists an opaque credential grant, and gives Host gateway consumers a cancellable identity capability. It never edits personal model settings or personal/company skills.

## Table of Contents

- [Use This Package](#use-this-package)
- [Understand the Implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use This Package

Load the credential provider, authorization service and native-authorization service before this plugin. Configuration requires `apiBaseUrl`, `organizations` and `defaultOrgId`; each organization supplies its exact `orgId`, `corpId`, numeric `agentId` and HTTPS `callbackUrl`, plus an optional display `label`. The API URL must be a pure HTTPS origin. Callback URLs cannot contain credentials, queries or fragments. Unknown fields, duplicate organizations and an unconfigured default fail startup. [Public deployment data](../../../tasks/fixtures/public-services/enterprise-identity.json) contains no credentials.

`requestTimeoutMs`, `attemptTimeoutMs`, `pollIntervalMs`, `observationIntervalMs` and `maxResponseBytes` bound issuer operations, attempts, polling, cross-process revocation detection and complete JSON responses. Defaults are 15 seconds, five minutes, 1.5 seconds, one second and 64 KiB respectively.

Renderer Remote methods are `listOrganizations`, `getState`, `watchState` and `signOut`. `watchState(signal)` publishes current safe state and coalesced identity changes, ending and removing its listener on subscriber cancellation or plugin disposal. `getState` verifies a saved grant with the issuer before returning `authenticated`; another caller can observe `restoring` while verification runs. Public identity fields are organization ID, user ID, display name, expiry and generation. Authentication errors use `uwork-enterprise/failed` with a typed reason and optional HTTP status. Upstream bodies, callback codes, tokens and handoff secrets are excluded from diagnostics and public projections. Failed verification remains a failure rather than silently becoming a successful sign-in.

Desktop uses the private native-authorization provider for start, callback completion, handoff polling and cancellation. Host-validated attempt expiry remains visible as the safe native `error: expired` projection, including after the attempt closes; starting a new attempt, cancelling that expired attempt or signing out clears it. Host consumers call `withSession(run, signal?)`; the callback receives the token and a generation-scoped signal only inside Host. Without a caller signal, plugin lifetime and identity cancellation still apply. Consumers must honor that signal and keep tokens out of their own public output. The method rejects signed-out access and observes persisted generation before use and again before returning through a read-only `modifyRecord` operation under the credential provider’s record lock. Periodic observation uses the same fresh read, so cache/watch latency cannot authorize a revoked capability.

## Understand the Implementation

Sign-in revokes the prior generation before requesting a handoff. HTTP 201 admits a validated handoff, HTTP 202 means pending, and only 404/405/501 at handoff start allow the native callback path without handoff support. Network errors, malformed responses, rate limits and 5xx failures do not trigger that fallback.

The issuer's `state` is the configured organization ID. The random attempt binding travels as `uwork_nonce` in the exact configured callback URL. Main callback ingestion checks origin, path, nonce, state, expiry, single-valued parameters and code bounds before submitting a code once. Login and successful claims require issuer refresh verification of the same organization and user. JWT expiry schedules local expiry; it is not proof of authentication.

Only `uwork-enterprise/identity` is written through the credentials grant API. A durable empty grant records a new generation on logout, preventing older writers from restoring a revoked session. Restoration holds the credential lock across server token rotation so another Host refreshes the latest token. Local switch/logout abort capabilities immediately; periodic observation detects another process's revocation or token rotation. Cancellation and plugin disposal abort owned requests and await their settlement. State notifications occur after persistence or safe withdrawal and contain listener failures. The generic `native-authorization/changed` event carries the same token-free native-provider projection for the private Desktop bridge.

## Further Exploration

- [Native authorization](../native-authorization/README.md)
- [Credentials](../credentials/README.md)
- [Authorization](../authorization/README.md)
- [Protocol baseline](../../../tasks/protocol-baseline.md)

## Model Experience

None, as this plugin owns Host authentication and contributes no model input or tool.

#### KV Cache effect

Identity state does not change prompts, retained messages or cache keys. Gateway and model-routing consumers own any resulting request changes.

## Known Limitations and Deferred Work

- Cross-process cancellation is detected within `observationIntervalMs`; an already accepted remote side effect cannot be undone by aborting its local request.
- A native callback-only issuer requires Desktop's private carrier; the generic authorization flow can complete automatically only when issuer handoff is supported.
- Credentials depend on the selected credential provider's durability and cross-process lock guarantees.

### Dev Note

Never import historical `.uwork` credentials into this grant or expose native callback ingestion through Remote. Deployment allowlists are public configuration; handoff secrets remain in attempt memory and tokens remain in the credential grant and Host capability.
