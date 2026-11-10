---
description: "Public company skill catalog and browsing"
kind: "package-reference"
---

# @deepseek-ai/dsh-uwork-company-market

English | [中文](README.zh.md)

## Summary

Read the PUBLIC SkillHub catalog selected by the [UWork desktop bundle](../../bundle/uwork-desktop/README.md). Enterprise sign-in is not required; catalog browsing does not install or execute skills.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Configure `baseUrl` with the SkillHub deployment root. HTTPS is required except for loopback HTTP deployments. The service exposes the `uworkCompanyMarket/search` Remote with text, a zero-based result page and cooperative cancellation. Empty text lists all skills; otherwise search is a case-insensitive substring of title, canonical slug or summary. The returned page includes the source, total matches and the next page or null.

<a id="understand-the-implementation"></a>
## Understand the implementation

The service reads `/.well-known/clawhub.json`, checks the declared API stays on the same origin, then follows numeric `nextCursor` pages to completion before searching. Redirects, credentials in URLs, repeated cursors, duplicate skills, invalid JSON and incomplete catalogs are refused. Each search reads a fresh catalog and sends no authorization header. Service disposal aborts and awaits active reads. Config defaults are `timeoutMs=30000` for the complete search, `maxResponseBytes=1048576` per response, `upstreamPageSize=50`, `maxPages=100`, `maxItems=5000`, `resultPageSize=50` and `maxQueryLength=512`. Limits fail visibly instead of truncating results.

<a id="further-exploration"></a>
## Further Exploration

- [Company market UI](../../client/ui-uwork-company-market/README.md)
- [Profile management](../../../docs/subsystems/boot.md)
- [Protocol baseline](../../../tasks/protocol-baseline.md)

<a id="model-experience"></a>
## Model Experience

None, as catalog reads add no model input.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Installation, updates, activation and removal belong to the separate skill-content transaction, not npm bundle installation.
- Private catalogs and enterprise credentials are unsupported.
- Every query fetches the complete catalog within configured limits; there is no persistent cache.

<a id="dev-note"></a>
### Dev Note

Public company skill catalogs retain their deployment ownership; this service stores no employee identity, token or API Key.
