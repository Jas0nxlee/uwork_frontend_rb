# Agent Note: UWork account resources and explicit key creation

Status: implemented

English | [中文](2026-11-10-uwork-account-resource-boundary.zh.md)

## Problem

The enterprise workbench needs account, organization, and managed-model status without receiving credentials or duplicating the native resource cache. Another window can log out or replace the active Host while a settings page remains mounted. A network failure after server-side key creation must not cause a second implicit creation request.

## Decision

[ui-uwork-enterprise](../../../../packages/client/ui-uwork-enterprise/README.md) publishes safe generated Remote observations through native Client resources and consumes them with `useResource`. The account provider follows `watchState`; organization labels are public configuration. Resource addresses include the native connection generation. Disconnect or Host replacement therefore selects a new source immediately, and reconnect opens a new authoritative stream. Model addresses also include the current verified identity generation, so a signed-out or failed account cannot retain an authenticated model panel.

The private snapshot store contains only mutation interaction facts: sign-out pending/failure and key-creation pending/uncertain outcome. It contains no credential, account projection, model catalog, read cache, or polling loop. Resource ownership supplies sharing, cancellation, and obsolete-frame rejection.

Automatic model reads use the safe non-creating refresh method. A managed-key creation requires a dedicated modal explaining the server action and a separate confirmation button. An uncertain response blocks further creation. A completed-action sequence in the model resource address forces a new read; only same-owner ready or capabilities-required observations can settle that interaction outcome. The resource command chain checks the current safe identity and connection after the read, and older holders cannot clear the result. The Host retains the durable reconciliation intent across restarts. Successful reads list published models and request a default selection only when the Host explicitly reports that one is missing.

## Alternatives considered

- An account controller with a second fetch cache would duplicate the standard resources layer and complicate invalidation.
- Keeping the same resource address across Host generations would preserve stale account details during disconnection.
- Treating refresh or reconnect as permission to create a key would turn a read into a server mutation and risk duplicate POSTs.

## Consequences

The renderer receives safe identity and model projections only. Cross-window logout withdraws account-only controls and managed-model content. Retained details after a read failure are explicitly stale and cannot enable account mutations. Native Main owns returning to the sign-in window; this settings page contains no embedded authorization browser or callback handler.
