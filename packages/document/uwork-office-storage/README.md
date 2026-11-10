---
description: "Office editor file service for deployments configuring bounded snapshots, guarded saves, and Session write policy."
kind: "package-reference"
---

# @deepseek-ai/dsh-uwork-office-storage

English | [中文](README.zh.md)

## Summary

Read complete DOCX, XLSX, and PPTX snapshots and publish guarded binary saves through the composed filesystem. This optional Host plugin registers `ctx.uworkOfficeStorage`; an editor consumer owns format validation and editing state.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Compose the plugin beside `fs` and `sandboxPolicy` in a profile layer. Remote calls use the authorized live `session` lookup; the owning Session service and Typert registry must be present when exposing the endpoints. Read and save accept paths inside the Session workspace, relative or absolute, ending in `.docx`, `.xlsx`, or `.pptx`, case-insensitively. Final-component symlinks and nonregular targets are refused.

| Configuration | Default | Meaning |
|---|---|---|
| `maxDocumentBytes` | `8388608` | Inclusive complete input/output byte cap before Base64 encoding. |
| `maxConcurrentOperations` | `8` | Admitted reads and saves; additional requests receive `busy`. |

`capabilities(session, signal)` reports the document cap and current write policy; it does not grant access. `stat(session, path, signal)` reads regular-file metadata without content. `read(session, path, signal)` returns complete native bytes and checks the filesystem version before and after reading. `save(session, request, signal)` accepts canonical padded Base64 and an explicit `createIfAbsent` or `replaceIfVersion` intent. A successful result reports only the saved snapshot; it does not clear subsequent editor changes. The plugin refuses targets outside the Session workspace and read-only saves. Other write checks use `sandboxPolicy.resolve({ session })` in the composed filesystem provider.

The [Office editing subsystem](../../../docs/subsystems/uwork-office-editor.md) owns the generated service and result reference. Client consumers mount this package’s generated `/remote` descriptor; it is not part of the ordinary `api/remotes` assembly.

<a id="understand-the-implementation"></a>
## Understand the implementation

Admission and cancellation belong to one provider lifetime. Unload refuses new operations, aborts active calls, and waits for them to settle before releasing dependencies. Encoded length is checked before decoding, and decoded length is checked before publication. The filesystem owns atomic publication and version conflict detection; this plugin adds no direct disk-write path.

<a id="further-exploration"></a>
## Further Exploration

- [Filesystem](../../fs/fs/README.md) — binary publication and provider guarantees.
- [Sandbox policy](../../sandbox/sandbox-policy/README.md) — Session-specific write policy.

<a id="model-experience"></a>
## Model Experience

None, as this package reads and saves editor bytes without model-facing tools, messages, or Session events.

#### KV Cache effect

None; file operations neither construct nor modify model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Format preservation, backup/recovery drafts, native Save As grants outside the Session workspace, and unsaved-edit decisions belong to the editor consumer; binary publication alone does not validate an OOXML archive.
- An interrupted response can leave publication unconfirmed. Reload and compare the document before retrying; no unconditional retry or overwrite is provided. Filesystem versions and the provider’s external-writer race limitations still apply.
- The Remote write request is JSON/Base64, while reads use binary result attachments. Deployment transports must admit the encoded request size; the filesystem provider may impose a stricter byte limit.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
