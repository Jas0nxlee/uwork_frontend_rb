/** Anonymous company skill catalog and verified content installation; no enterprise identity or npm installation dependency. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { watchFile, unwatchFile } from 'node:fs'
import { CompanySkillProvider } from './provider.ts'
import { isAbsolute, join } from 'node:path'
import type {} from '@deepseek-ai/dsh-app-boot'
import { CompanyInstallStore } from './install-store.ts'
import type { CompanyInstallations, InstalledCompanySkill, InstallLimits } from './install-types.ts'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { normalizeSource, readCatalog } from './catalog.ts'
import type { CatalogOptions, CompanyMarketPage } from './types.ts'

/** Company market deployment and query limits. */
export interface Config extends CatalogOptions, InstallLimits {
  /** Absolute owned store directory; absent uses company-skills in the current profile, or catalog-only mode without a profile. */
  readonly installDir?: string
  /** Maximum search text length in UTF-16 code units. */
  readonly maxQueryLength: number
  /** Cross-process installation-index observation interval in milliseconds. */
  readonly installationWatchMs: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Anonymous company skill catalog and company-owned installation manager. */
    uworkCompanyMarket: CompanyMarket
  }
}

/** Reads the PUBLIC SkillHub catalog and activates verified company skills. */
export default class CompanyMarket extends TypertRemoteService {
  static Config = z.object({
    baseUrl: z.string().required(),
    installDir: z.string().min(1),
    maxArchiveBytes: z.natural().min(1).default(25 * 1024 * 1024),
    maxArchiveEntries: z.natural().min(1).default(4096),
    maxFileBytes: z.natural().min(1).default(16 * 1024 * 1024),
    maxExpandedBytes: z.natural().min(1).default(100 * 1024 * 1024),
    maxPathBytes: z.natural().min(1).default(512),
    maxManifestBytes: z.natural().min(1).default(4 * 1024 * 1024),
    maxInstalledSkills: z.natural().min(1).default(128),
    maxStoredVersions: z.natural().min(1).default(256),
    installTimeoutMs: z.natural().min(1).max(2147483647).default(120000),
    lockWaitMs: z.natural().min(1).max(2147483647).default(120000),
    timeoutMs: z.natural().min(1).max(2147483647).default(30000),
    maxResponseBytes: z.natural().min(1).default(1048576),
    upstreamPageSize: z.natural().min(1).max(100).default(50),
    maxPages: z.natural().min(1).default(100),
    maxItems: z.natural().min(1).default(5000),
    resultPageSize: z.natural().min(1).max(100).default(50),
    installationWatchMs: z.natural().min(1).max(2147483647).default(1000),
    maxQueryLength: z.natural().min(1).default(512),
  })

  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly invalidators = new Set<() => void>()
  private readonly options: Config
  private readonly store: CompanyInstallStore | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'uworkCompanyMarket')
    this.options = { ...config, baseUrl: normalizeSource(config.baseUrl) }
    const profile = ctx.get('profileContext')
    const directory = config.installDir ?? (profile === undefined ? undefined : join(profile.dir, 'company-skills'))
    if (directory !== undefined && !isAbsolute(directory)) throw new Error('Company skill installation directory must be absolute')
    this.store = directory === undefined ? undefined : new CompanyInstallStore(directory, this.options, ctx)
    const store = this.store
    if (store !== undefined && directory !== undefined) {
      ctx.inject(['skills'], (scope) => {
        scope.skills.registerProvider((control) => {
          this.invalidators.add(control.invalidate)
          control.signal.addEventListener('abort', () => this.invalidators.delete(control.invalidate), { once: true })
          return new CompanySkillProvider(scope, store, control)
        })
      })
      ctx.effect(() => {
        const index = join(directory, 'index.json')
        const changed = () =>{  this.invalidate() }
        watchFile(index, { persistent: false, interval: config.installationWatchMs }, changed)
        return () =>{  unwatchFile(index, changed) }
      })
    }
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

  /**
   * Read current installed versions, recovering only owned staging and never-activated candidates.
   * @param signal - caller cancellation.
   * @returns installation availability and current versions; catalog-only compositions report unavailable.
   */
  @Remote
  async installations(signal: AbortSignal): Promise<CompanyInstallations> {
    if (this.store === undefined) return { available: false, skills: [] }
    const active = AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(this.options.installTimeoutMs)])
    const request = this.store.list(active)
    this.pending.add(request)
    try { return { available: true, skills: await request } }
    catch (error) {
      if (error instanceof RemoteError) throw error
      if (signal.aborted || this.lifetime.signal.aborted) throw active.reason
      throw new RemoteError('uwork-company-market/state-invalid', 'Company skill installation state could not be read', {}, { cause: error })
    }
    finally { this.pending.delete(request) }
  }

  /**
   * Install or update one exact public version through a verified content transaction.
   * @param slug - selected canonical SkillHub slug.
   * @param version - exact published version.
   * @param signal - caller cancellation; an admitted atomic commit may complete after cancellation.
   * @returns the current installed version after activation, or the same version on an idempotent retry.
   */
  @Remote
  async installSkill(slug: string, version: string, signal: AbortSignal): Promise<InstalledCompanySkill> {
    if (this.store === undefined) throw new RemoteError('uwork-company-market/storage-unavailable', 'Company skill installation is unavailable', {})
    const active = AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(this.options.installTimeoutMs)])
    const request = this.store.install(slug, version, active)
    this.pending.add(request)
    try { return await request }
    finally { this.pending.delete(request); this.invalidate() }
  }

  /**
   * Change whether one installed company skill participates in future discovery.
   * @param slug - canonical installed slug.
   * @param enabled - next discovery state.
   * @param signal - caller cancellation.
   * @returns the refreshed installation list after the change.
   */
  @Remote
  async setEnabled(slug: string, enabled: boolean, signal: AbortSignal): Promise<CompanyInstallations> {
    return await this.changeInstallation(slug, enabled, signal)
  }

  /**
   * Remove only the selected company installation from future discovery.
   * @param slug - canonical company-owned slug; personal skills are unaffected.
   * @param signal - caller cancellation.
   * @returns the refreshed installation list after removal.
   */
  @Remote
  async uninstallSkill(slug: string, signal: AbortSignal): Promise<CompanyInstallations> {
    return await this.changeInstallation(slug, null, signal)
  }

  private async changeInstallation(slug: string, enabled: boolean | null, signal: AbortSignal): Promise<CompanyInstallations> {
    if (this.store === undefined) throw new RemoteError('uwork-company-market/storage-unavailable', 'Company skill installation is unavailable', {})
    const active = AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(this.options.installTimeoutMs)])
    const request = this.store.change(slug, enabled, active)
    this.pending.add(request)
    try { return { available: true, skills: await request } }
    finally { this.pending.delete(request); this.invalidate() }
  }

  private invalidate(): void {
    for (const invalidate of this.invalidators) invalidate()
  }
}
