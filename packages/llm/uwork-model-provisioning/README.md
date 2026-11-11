---
description: "Host-only managed enterprise model routes and crash reconciliation."
kind: "package-reference"
---

# @deepseek-ai/dsh-uwork-model-provisioning

English | [中文](README.zh.md)

## Summary

This Host service provisions explicit authorized model routes through native `llm-pi-ai`. Settings store a generation-specific credential reference; the credentials provider stores its secret and an owner-scoped recovery journal. Personal providers and personal defaults are preserved.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The optional `publicModelCatalog` enables custom-provider metadata lookup from `https://models.dev/api.json`. Exact endpoint/model IDs and canonical identities determine matches; ambiguous or unknown aliases remain unresolved. Reasoning effort values are included when explicitly listed. A reasoning flag alone does not create an effort list. Only public capability fields are cached in the active profile’s `.model-catalog` directory. The cache refreshes after 24 hours, retains the last valid catalog on failure, and retries failed refreshes after five minutes. No provider credential or user message is sent to this directory. This lookup does not grant enterprise model access.

Mount after `credentials`, `settings`, `agentDefaultModel`, and native `llm-pi-ai`. `settingsNamespace` defaults to `llm-pi-ai`. A Host identity callback calls `uworkModelProvisioning.provision(input)` with its org/user/generation, operation and optional identity lifetime signals, candidate route and fresh credential reference, public HTTPS inference endpoint, API key, authorized model ids, verified capability declarations, and preferred model order. Never expose this input through a Renderer method. With `gatewayApiBaseUrl` and explicit `allowedModelEndpointOrigins` configured, authenticated identity changes refresh authorization automatically. Optional `modelCatalog` declares each legacy endpoint model’s context window, text/image inputs, request output budget, reasoning levels and thinking dialect. `legacyTextCatalog` remains available for uniformly text-only deployments. Models must still be listed by the key and authorized by the account; explicit endpoint capabilities take precedence. Safe Remote methods `getState`, `refresh`, and `createManagedKey` return status only. Only the explicit `createManagedKey(expectedBinding, signal)` action can create a key for the exact org/user/generation captured by its confirmation; a durable per-account intent blocks repeated POSTs after unknown outcomes until a fresh key listing reconciles its alias. Managed provider subtrees are reserved through Settings for this plugin’s own updates. `retiredDefaultProviders` names removed product providers whose saved default is replaced by an authorized preferred model.

<a id="understand-the-implementation"></a>
## Understand the implementation

The transaction writes a staged journal, stores the secret, applies a settings revision check, and marks the journal committed before admitting requests. Failed commits remove only the matching owned route and secret. Failed compensation leaves the journal available for `recover()`. Startup reconciliation never treats persisted credentials as current authorization. Journal updates compare the expected owned credential reference under the credential provider's record lock.

Managed native discovery is refused before credential access; authorized capability refresh goes through the gateway. The `uwork-` route prefix is reserved for this owner. The native request-signal hook denies inactive managed routes before credential resolution. Revoking the identity signal aborts in-flight inference; releasing a settings reader does not revoke a committed route. Explicit authorized ids (or the verified directory when the server explicitly authorizes unrestricted access) intersect verified capability declarations; the explicit model list prevents model discovery from widening authorization. Refreshing the same account retains its provider ID and any still-authorized default while replacing the credential reference. An empty default or an obsolete default owned by that account uses the first preferred authorized model. Personal defaults and Session selections stay unchanged.

<a id="model-experience"></a>
## Model Experience

Indirectly, through native pi-ai requests and the model selection consumed by the Agent.

#### KV Cache effect

Authorization changes do not rewrite Session history or its request prefix. The native adapter and subsequent model selection own the actual request.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The caller supplies explicit endpoint or release declarations; model names do not establish image or reasoning support.
- Real authenticated gateway capability and inference validation remain necessary.
- This package does not declare currency or infer spend from tokens.
- A changed route that no longer matches the journal is retained for inspection while its owned secret is removed.

### Dev Note

Owner-local transaction tests cover compensation, revision conflict, restart, personal defaults, authorization intersection and cancellation. The Loader composition test uses real profile persistence, credentials-local, settings, agent-default-model and pi-ai.
