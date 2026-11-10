# UWork Office 编辑

[English](uwork-office-editor.md) | 中文

[document 包族](../../packages/document/README.zh.md)负责 Host 文档操作。可选 [Office 存储插件](../../packages/document/uwork-office-storage/README.zh.md)读取有界完整快照并执行带版本保护的二进制保存；编辑器消费者负责 OOXML 编辑、格式保真及恢复。

## 文件操作

`OfficeFileStatus` 报告普通文件元数据；`OfficeEditorCapabilities` 报告字节上限及当前写入策略，不授予访问权。`OfficeFileSnapshot` 包含规范绝对路径、带品牌的 `FsVersion`、完整字节数及原生 `Uint8Array`。只有源文件保持观察版本时读取才返回。`OfficeFileSaveRequest` 携带目标路径、规范 Base64 快照及显式文件系统写入意图。`OfficeFileSaved` 标识已确认发布，与编辑器当前状态独立。

Remote 方法使用已授权的活动 Session 查询。所有文件目标须在会话工作区内；插件拒绝只读保存，文件系统提供者执行当前会话策略；选中可编辑格式不会授予写权限。`office-file/failed` 携带 `OfficeFileFailure` 原因，包括类型化文件系统错误、不支持的格式、非法 Base64 及操作接纳拒绝。取消返回 `gateway/cancelled`。

读取结果使用二进制附件；写入参数使用 JSON/Base64。[插件 README](../../packages/document/uwork-office-storage/README.zh.md)说明部署上限、生命周期保证及发布限制。此服务不增加模型输入或 Session 事件。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Session](session.zh.md)

Source: [`packages/document/uwork-office-storage/src/index.ts`](../../packages/document/uwork-office-storage/src/index.ts)
<!-- END GENERATED cordis-surface -->
