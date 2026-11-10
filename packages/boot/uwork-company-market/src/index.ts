/** Anonymous company skill catalog; no enterprise identity or npm installation dependency. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { normalizeSource, readCatalog } from './catalog.ts'
import type { CatalogOptions, CompanyMarketPage } from './types.ts'

/** Company market deployment and query limits. */
export interface Config extends CatalogOptions {
  /** Maximum search text length in UTF-16 code units. */
  readonly maxQueryLength: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Anonymous, read-only company skill catalog. */
    uworkCompanyMarket: CompanyMarket
  }
}

/** Reads and searches the complete configured PUBLIC SkillHub catalog. */
export default class CompanyMarket extends TypertRemoteService {
  static Config = z.object({
    baseUrl: z.string().required(),
    timeoutMs: z.natural().min(1).max(2147483647).default(30000),
    maxResponseBytes: z.natural().min(1).default(1048576),
    upstreamPageSize: z.natural().min(1).max(100).default(50),
    maxPages: z.natural().min(1).default(100),
    maxItems: z.natural().min(1).default(5000),
    resultPageSize: z.natural().min(1).max(100).default(50),
    maxQueryLength: z.natural().min(1).default(512),
  })

  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly options: Config

  constructor(ctx: Context, config: Config) {
    super(ctx, 'uworkCompanyMarket')
    this.options = { ...config, baseUrl: normalizeSource(config.baseUrl) }
    ctx.effect(() => async () => {
      this.lifetime.abort()
      await Promise.allSettled([...this.pending])
    })
  }

  /**
   * Search title, canonical slug and summary after reading the complete public catalog.
   * @param text - case-insensitive substring; empty text lists all skills.
   * @param page - zero-based result page.
   * @param signal - caller cancellation, combined with the service lifetime and catalog deadline.
   * @returns one bounded page, its total matches and the next result page.
   */
  @Remote
  async search(text: string, page: number, signal: AbortSignal): Promise<CompanyMarketPage> {
    if (text.length > this.options.maxQueryLength || !Number.isSafeInteger(page) || page < 0) {
      throw new RemoteError('uwork-company-market/invalid-query', 'Invalid company market query', {})
    }
    const active = AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(this.options.timeoutMs)])
    const request = readCatalog(this.options, active)
    this.pending.add(request)
    try {
      const all = await request
      const query = text.trim().toLocaleLowerCase('en')
      const matching = all.filter(item => `${item.slug}\n${item.title}\n${item.summary}`.toLocaleLowerCase('en').includes(query))
      const start = page * this.options.resultPageSize
      if (!Number.isSafeInteger(start) || (page > 0 && start >= matching.length)) {
        throw new RemoteError('uwork-company-market/invalid-query', 'Company market page is out of range', {})
      }
      return {
        source: this.options.baseUrl, items: matching.slice(start, start + this.options.resultPageSize), total: matching.length, page,
        nextPage: start + this.options.resultPageSize < matching.length ? page + 1 : null,
      }
    } catch (error) {
      if (error instanceof RemoteError) throw error
      if (signal.aborted || this.lifetime.signal.aborted) throw active.reason
      throw new RemoteError('uwork-company-market/unavailable', 'Company market could not be reached', { reason: 'network' }, { cause: error })
    } finally { this.pending.delete(request) }
  }
}
