---
description: "Optional UWork Word document editing and guarded file saves."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-uwork-office-editor

English | [中文](README.zh.md)

## Summary

Edit Word documents in dsh file tabs and decide how to handle unsaved changes before closing or reloading. Saves check file versions and refuse to overwrite external changes.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Compose both entries through the [Office bundle](../../bundle/uwork-office-editor/README.md). For direct configuration, mount these rows in a Web or Desktop profile.

```yaml
- name: '@deepseek-ai/dsh-uwork-office-storage'
- name: '@deepseek-ai/dsh-client-ui-uwork-office-editor'
```

| Field | Default | Meaning |
|---|---|---|
| `maxDocumentXmlBytes` | `4194304` | Expanded main-document XML admission cap. |
| `minRetainedTextRatio` | `0.8` | Minimum retained text proportion on export. |
| `revisionAuthor` | `UWork` | Author attributed to new Word revisions. |

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

Editor models and complete bytes remain in the tab lifetime. Asynchronous export captures an independent snapshot first; confirmed publication does not clear later edits. Temporary SDK operations are serialized across documents because the DOCX engine shares export working state. Plugin disposal cancels and drains active operations before destroying engines.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Office](../../../docs/subsystems/uwork-office-editor.md)
- [Filesystem](../../fs/fs/README.md)
- [Sidebar](../../client/ui-sidebar-right/README.md)

<a id="model-experience"></a>
## Model Experience

None, as document editing and saving add no model input or Session events.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The current Client claims DOCX only. XLSX and PPTX editing, the full Word toolbar and review controls remain migration work.
- Native Save As, application quit decisions, forced-termination recovery drafts, and signed desktop installer acceptance are not implemented.
- File operations are limited to the Session workspace. A read-only policy disables editing. Invalid exports retain the live edits and do not publish.
- DOCX preservation tests exercise ZIP and XML metadata; they do not establish Word/WPS reopen fidelity or Windows x64 and Mac ARM acceptance.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
