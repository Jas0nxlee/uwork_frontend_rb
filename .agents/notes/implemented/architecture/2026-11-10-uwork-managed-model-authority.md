# Agent Note: UWork managed model authority and transaction recovery

Status: implemented

English | [中文](2026-11-10-uwork-managed-model-authority.zh.md)

## Problem

An enterprise model route spans credentials, profile settings, current identity, model capabilities, and a default selection. Those stores do not share a transaction. A crash can leave a configured route without a credential, or a credential without current authorization. A failed key-creation response cannot establish whether the server created a key. Reusing personal credential names, discovering extra models, or replacing a concurrent personal default would turn recovery into an authority expansion.

## Decision

[uwork-model-provisioning](../../../../packages/llm/uwork-model-provisioning/README.md) owns the Host transaction. Its credential journal binds organization, user, generation, fresh provider id, and a fresh credential reference. Settings contain the reference and explicit native pi-ai model declarations; secrets remain in the credential provider. A staged journal precedes the secret and settings revision writes. Admission opens only after the committed journal write. Failure compensates matching owned values; startup removes the old route and credential instead of trusting persisted material as authentication. Recovery compares the raw owned profile, including display and reasoning fields, so schema defaults do not conceal user edits. Settings mutations touch only the owned provider path.

Inference authorization runs before credential resolution through the synchronous `llm-pi-ai/request-signal` waterfall. It verifies the exact endpoint, current raw profile and selected authorized model, and composes the identity lifetime with caller cancellation. Logout and account replacement stop admission and abort in-flight inference. Managed native model discovery is refused through `llm-pi-ai/discovery-signal`, before either stored or one-shot keys can be sent to an edited endpoint; capability reads instead use the generation-scoped gateway client and an explicit deployment origin allowlist. Personal discovery continues through `next()`.

Only complete endpoint capability facts intersected with explicit account authorization become selectable. Explicit unrestricted authorization permits the verified endpoint catalog; absence or discovery failure never widens access. Model names do not establish token limits, tools, images, or reasoning. Missing facts produce `capabilities-required`. Release `preferredModels` order intersects the selectable models; an empty order requests selection. Personal defaults and Session selections remain unchanged. Same-account managed defaults may update through `agentDefaultModel.saveSelection(next, expected)`, whose comparison runs under the profile writer lock and preserves a concurrent personal choice.

Creating a key requires the separate explicit Remote action with the organization, user and generation captured by its confirmation. The Host compares that snapshot inside the actual identity callback, before constructing the gateway client or admitting any POST; a late confirmation cannot create a key for a replacement account. A per-account credential intent, with a fresh alias, is written before the single POST. Unknown outcomes and pending crash records permit listing and alias reconciliation, never another implicit POST. Creation admission and every completion compare ownership under the credential record lock, so an old response cannot overwrite a newer alias. Cancellation known to precede the POST compensates its intent. The [account-resource decision](2026-11-10-uwork-account-resource-boundary.md) separately owns Renderer observations and interaction state; only safe status DTOs cross Remote.

## Alternatives considered

**A second LLM transport.** It would duplicate native streaming, tools, attachments and Session replay. The managed route uses pi-ai instead.

**Personal or ambient keys.** Reusing a personal default key or omitting the reference could silently authenticate outside the enterprise account.

**Persisted readiness.** Trusting a saved ready flag or retaining active routes on logout would let persistence outlive authorization.

**Implicit retry or fallback.** Retrying an uncertain POST or choosing another model after revocation would hide an unresolved mutation or change the user's explicit choice.

**Name-based capabilities.** Treating a catalog name as evidence would inherit unrelated upstream limits or modalities through a gateway alias.

## Consequences

The `uwork-` provider prefix is reserved for managed routes. A user-edited managed profile can remain available for inspection after cleanup, but its owned credential is removed and its old route cannot dispatch. Unknown key outcomes can require server-side reconciliation when no matching alias becomes observable. Real authenticated model capability and inference validation remain deployment evidence; local mocks do not establish that a production gateway serves a declared modality.

Owner-local tests cover each staged write interruption, restart compensation, settings and credential races, alias ownership, exact-endpoint admission, authorization shrinkage, explicit unrestricted access, and personal-default protection. A real Loader profile exercises credentials-local, settings, default selection and native pi-ai together; native discovery tests prove refused managed drafts neither resolve stored credentials nor perform network I/O. A second profile runtime verifies conditional default writes against a concurrent personal save.
