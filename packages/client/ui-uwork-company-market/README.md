---
description: "Public company skill catalog and browsing"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-uwork-company-market

English | [中文](README.zh.md)

## Summary

Browse and search public company skills from the Plugins page. The [UWork bundle](../../bundle/uwork-desktop/README.md) mounts this tab and its [catalog Host](../../boot/uwork-company-market/README.md) together.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The Company market tab uses `plugins.tab` and has no configuration fields. Enter a search and submit it, navigate result pages, or refresh the requested query. Source, canonical slug, summary and published version are displayed without requiring enterprise sign-in. No placeholder install action is shown.

<a id="understand-the-implementation"></a>
## Understand the implementation

One root-owned controller retains the query and its last result across tab mounts. A new query cancels the old invocation; late results cannot overwrite the new query. Failure retains previous rows with a notice and retry action, while pagination waits for a successful result. Unload aborts requests, releases the tab and dictionaries, and removes the generated Remote namespace. Copy is provided in eight application languages; controls and cards use shared primitives and theme tokens.

<a id="further-exploration"></a>
## Further Exploration

- [Catalog Host](../../boot/uwork-company-market/README.md)
- [Plugins slots](../ui-plugin-manager/README.md)
- [Theme](../ui-theme/README.md)

<a id="model-experience"></a>
## Model Experience

None, as public catalog presentation adds no model input.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- This tab is read-only until the skill-content installation transaction and provider are available.
- Private-market authentication and editing the built-in source are unsupported.

<a id="dev-note"></a>
### Dev Note

The tab never passes SkillHub content to the Plugins page npm installer.
