/** Deployment policy shared by the Office Host and Client entries. */
import z from '@deepseek-ai/schemastery'

/** Word parser admission and export validation settings. */
export interface Config {
  /** Maximum expanded main-document XML size before engine import. */
  maxDocumentXmlBytes: number
  /** Minimum retained visible text proportion on export. */
  minRetainedTextRatio: number
  /** Author attributed to edits recorded as Word revisions. */
  revisionAuthor: string
}

/** Validated settings embedded by the Host when serving the browser. */
export const Config: z<Partial<Config>, Config> = z.object({
  maxDocumentXmlBytes: z.natural().min(1).max(Number.MAX_SAFE_INTEGER).default(4 * 1024 * 1024),
  minRetainedTextRatio: z.number().min(0).max(1).default(0.8),
  revisionAuthor: z.string().min(1).default('UWork'),
})
