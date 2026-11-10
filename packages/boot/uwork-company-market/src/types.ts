/** Public company skill catalog records; installed skills have a separate owner. */
import type {} from '@deepseek-ai/dsh-typert-protocol'

/** One published SkillHub skill, identified by its canonical slug. */
export interface CompanySkill {
  /** Bare global slug or a namespace and slug joined by `--`. */
  readonly slug: string
  /** Plain display text supplied by the catalog. */
  readonly title: string
  /** Plain skill description supplied by the catalog. */
  readonly summary: string
  /** Published version selected by the catalog. */
  readonly version: string
}

/** A search page from the complete public catalog. */
export interface CompanyMarketPage {
  /** Configured deployment root, never an arbitrary caller-selected URL. */
  readonly source: string
  /** Matching skills on this result page. */
  readonly items: readonly CompanySkill[]
  /** Matches in the complete upstream catalog. */
  readonly total: number
  /** Zero-based result page. */
  readonly page: number
  /** Next result page, or null after the final page. */
  readonly nextPage: number | null
}

/** Configured transport and catalog limits. */
export interface CatalogOptions {
  /** SkillHub deployment root; HTTPS except for loopback HTTP. */
  readonly baseUrl: string
  /** Deadline in milliseconds for discovery and every catalog page together. */
  readonly timeoutMs: number
  /** Maximum bytes in one discovery or catalog response. */
  readonly maxResponseBytes: number
  /** Requested skills per upstream page. */
  readonly upstreamPageSize: number
  /** Maximum upstream pages before refusing an incomplete catalog. */
  readonly maxPages: number
  /** Maximum skills retained while reading the complete catalog. */
  readonly maxItems: number
  /** Maximum matches returned in a search result page. */
  readonly resultPageSize: number
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The source cannot provide a complete, validated catalog. */
    'uwork-company-market/unavailable': {
      readonly reason: 'network' | 'http' | 'unauthorized' | 'forbidden' | 'rate-limited' | 'invalid' | 'limit'
      readonly status?: number
    }
    /** A ZIP or resolver result cannot safely become an installed skill. */
    'uwork-company-market/invalid-package': {
      readonly reason: 'path' | 'symlink' | 'duplicate' | 'format' | 'fingerprint' | 'identity' | 'version' | 'limit' | 'missing-skill'
    }
    /** Installation did not complete, or its persisted outcome could not be read back. */
    'uwork-company-market/install-failed': { readonly outcome: 'unchanged' | 'committed' | 'unknown' }
    /** The saved installation index or a version manifest is invalid. */
    'uwork-company-market/state-invalid': Record<string, never>
    /** This composition has no profile-owned or explicitly configured skill store. */
    'uwork-company-market/storage-unavailable': Record<string, never>
    /** Search text or page is outside the supported range. */
    'uwork-company-market/invalid-query': Record<string, never>
  }
}
