/** Complete Office snapshots and explicit guarded publication requests. */
import type { FsErrorCode, FsVersion, FsWriteIntent } from '@deepseek-ai/dsh-fs'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-typert-protocol'

/** Regular-file identity without loading document contents. */
export interface OfficeFileStatus {
  readonly absolutePath: string
  readonly version: FsVersion
  readonly bytes?: number
}

/** Source identity returned only after a bounded read and a second version check. */
export interface OfficeFileSnapshot extends OfficeFileStatus {
  readonly bytes: number
  readonly data: Uint8Array
}

/** Editor admission hints; filesystem permissions and destination policy still apply when saving. */
export interface OfficeEditorCapabilities {
  readonly maxDocumentBytes: number
  readonly writePolicy: SandboxMode
}

/** One complete serialized document; Save As uses createIfAbsent until overwrite is explicitly approved. */
export interface OfficeFileSaveRequest {
  readonly path: string
  /** Canonical padded RFC 4648 Base64; Remote parameters do not support binary attachments. */
  readonly contentBase64: string
  readonly expected: FsWriteIntent
}

/** Publication identity, independent of any edits made while saving. */
export interface OfficeFileSaved {
  readonly absolutePath: string
  readonly version: FsVersion
  readonly bytes: number
  readonly operation: 'create' | 'update'
}

/** Classified refusal without document content or backend diagnostics. */
export type OfficeFileFailure = FsErrorCode | 'unsupported-format' | 'invalid-base64' | 'busy'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Read or save did not return a confirmed document snapshot. */
    'office-file/failed': { readonly reason: OfficeFileFailure }
  }
}
