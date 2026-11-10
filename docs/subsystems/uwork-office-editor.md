# UWork Office editing

English | [中文](uwork-office-editor.zh.md)

The [document package family](../../packages/document/README.md) owns Host document operations. The optional [Office storage plugin](../../packages/document/uwork-office-storage/README.md) reads bounded complete snapshots and publishes version-guarded binary saves; editor consumers own OOXML editing, format preservation, and recovery.

## File operations

`OfficeFileStatus` reports regular-file metadata; `OfficeEditorCapabilities` reports the byte cap and current write policy without granting access. `OfficeFileSnapshot` contains the canonical absolute path, branded `FsVersion`, complete byte count, and native `Uint8Array`. A read returns only when the source retains its observed version. `OfficeFileSaveRequest` carries a destination path, canonical Base64 snapshot, and explicit filesystem write intent. `OfficeFileSaved` identifies the confirmed publication independently of the editor’s current state.

Remote methods use the authorized live Session lookup. All file targets remain inside the Session workspace; the plugin refuses read-only saves, and the filesystem provider enforces the current Session policy; selecting an editable format does not grant write access. `office-file/failed` carries an `OfficeFileFailure` reason, including typed filesystem errors, unsupported format, invalid Base64, and operation admission refusal. Cancellation returns `gateway/cancelled`.

Read results use binary attachments; write parameters use JSON/Base64. The [plugin README](../../packages/document/uwork-office-storage/README.md) owns deployment caps, lifecycle guarantees, and publication limitations. No model input or Session event is added by this service.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxuworkofficestorage--uworkofficestorage"></a>

### `ctx.uworkOfficeStorage` — `UworkOfficeStorage`

Optional Office editor backend; every mutation uses the calling Session's current write policy.

```ts cordis-catalog
/**
 * Query editor admission hints without granting file access or changing policy.
 * @param session - authorized live Session whose current policy is reported.
 * @param signal - caller cancellation.
 * @returns document cap and current Session policy; saving remains subject to workspace and filesystem checks.
 */
@Remote capabilities(session: Session, signal: AbortSignal): Promise<OfficeEditorCapabilities>

/**
 * Inspect a regular Office file without reading its bytes.
 * @param session - authorized live Session used to resolve relative paths.
 * @param path - absolute source or Session-relative path.
 * @param signal - caller cancellation.
 * @returns canonical source identity and byte size when the backend reports it.
 */
@Remote stat(session: Session, path: string, signal: AbortSignal): Promise<OfficeFileStatus>

/**
 * Read a complete DOCX, XLSX, or PPTX with a stable observed filesystem version.
 * @param session - authorized live Session supplied by the Remote lookup.
 * @param path - absolute source or path relative to the Session workspace.
 * @param signal - caller cancellation; plugin unload also cancels the read.
 * @returns the complete bytes and the version to use for a later guarded save.
 */
@Remote read(session: Session, path: string, signal: AbortSignal): Promise<OfficeFileSnapshot>

/**
 * Publish a complete serialized document under an explicit create or observed-version intent.
 * @param session - authorized live Session whose current policy controls the mutation.
 * @param request - destination, complete Base64 snapshot, and required write intent.
 * @param signal - cancellation before publication; an interrupted response requires reloading before retry.
 * @returns confirmed publication metadata; never implies that newer editor changes were saved.
 */
@Remote save(session: Session, request: OfficeFileSaveRequest, signal: AbortSignal): Promise<OfficeFileSaved>
```

Types: [Session](session.md)

Source: [`packages/document/uwork-office-storage/src/index.ts`](../../packages/document/uwork-office-storage/src/index.ts)
<!-- END GENERATED cordis-surface -->
