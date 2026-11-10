---
description: "Public company skills, verified installation and native discovery"
kind: "package-reference"
---

# @deepseek-ai/dsh-uwork-company-market

English | [中文](README.zh.md)

## Summary

Read the PUBLIC SkillHub catalog selected by the [UWork desktop bundle](../../bundle/uwork-desktop/README.md). Enterprise sign-in is not required; catalog browsing does not install or execute skills. Explicit install actions activate verified content for native skill discovery.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Configure `baseUrl` with the SkillHub deployment root. HTTPS is required except for loopback HTTP deployments. The service exposes the `uworkCompanyMarket/search` Remote with text, a zero-based result page and cooperative cancellation. Empty text lists all skills; otherwise search is a case-insensitive substring of title, canonical slug or summary. The returned page includes the source, total matches and the next page or null. Global `global--slug` aliases are returned as bare slugs so catalog and saved installations share one identity.

`installations`, `installSkill`, `setEnabled` and `uninstallSkill` manage only this source's content. Installation storage defaults to `<profile.dir>/company-skills`; an absolute `installDir` overrides it. Without either location the service remains catalog-only. Disabled skills remain installed; uninstall removes their activation record and recovery cleans their owned versions. Personal skills and npm plugins are untouched.

The [UWork bundle](../../bundle/uwork-desktop/cordis.patch.yml) supplies this mount:

```yaml
- id: uwork-company-market
  name: '@deepseek-ai/dsh-uwork-company-market'
  config:
    baseUrl: https://aihub.ucas.com.cn/skillhub
```

| Field | Default | Meaning |
|---|---|---|
| `baseUrl` | Required | Public SkillHub deployment root. |
| `installDir` | `<profile.dir>/company-skills`, or catalog-only without a profile | Absolute company-owned content store. |

The [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-uwork-company-market) lists all transport, decompression, storage and observation limits.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The service reads `/.well-known/clawhub.json`, checks the declared API stays on the same origin, then follows numeric `nextCursor` pages to completion before searching. Redirects, credentials in URLs, repeated cursors, duplicate skills, invalid JSON and incomplete catalogs are refused. Each search reads a fresh catalog and sends no authorization header. Service disposal aborts and awaits active reads. Configured limits fail visibly instead of truncating results.

An installation discovers and resolves the exact namespace, slug and version, admits only the matching same-origin download route, and streams a bounded ZIP into private staging. Extraction rejects traversal, links, portable-name collisions, missing root `SKILL.md`, invalid native skill metadata or empty instructions, oversized entries and mismatched compound SHA-256 fingerprints. Extracted files retain only owner access, including an archive-declared execute bit; group, other and special permissions are stripped. A cross-process lock serializes installation and management. Complete immutable generations move into `versions` before one atomic index replacement activates them; replacement is not a power-loss durability guarantee. Skill lookups read atomic index snapshots without waiting for an update download; previous committed generations remain for running work until uninstall. Failed activation preserves the prior pointer. Lost write acknowledgements are read back; unreadable outcomes retain the candidate and report `unknown` instead of deleting possibly committed content. Invalid saved state blocks management rather than becoming an empty installation list.

When `skills` is present, a registration-scoped provider reuses the native filesystem parser with only enabled generation roots. Personal filesystem ranks win duplicate names. Successful management invalidates discovery immediately; `installationWatchMs` bounds detection of another process's index changes. Configured compressed, expanded, entry, file, path, manifest, installation and retained-version limits reject complete operations rather than silently trimming content. Reaching the retained-version budget requires uninstalling an owned skill before installing further versions.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Company market UI](../../client/ui-uwork-company-market/README.md)
- [Profile management](../../../docs/subsystems/boot.md)
- [Protocol baseline](../../../tasks/protocol-baseline.md)

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-skill`: enabled installed skills contribute names and descriptions to its catalog; selected instruction bodies and resource-base guidance enter retained tool history. Catalog browsing and installation metadata add no model input.

#### KV Cache effect

Installation, enable changes and uninstall invalidate skill discovery, allowing the native consumer to append a replacement catalog without rewriting previous tool results.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Installation verifies published content integrity, not its safety to execute. Skill execution continues through native tool permissions and approvals.
- Historical committed versions consume the configured store budget until uninstall; automatic eviction is unsupported.
- Private catalogs and enterprise credentials are unsupported.
- Every query fetches the complete catalog within configured limits; there is no persistent cache.

<a id="dev-note"></a>
### Dev Note

Public company skill catalogs retain their deployment ownership; this service stores no employee identity, token or API Key.
