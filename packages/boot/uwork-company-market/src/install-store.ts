/** Immutable skill versions activated by one cross-process-locked atomic index. */
import type { Context } from '@deepseek-ai/cordis'
import { validateCompanyPackage } from './provider.ts'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { contentFingerprint, extractPackage, portablePath, packageFailure } from './archive.ts'
import { downloadPackage, skillIdentity } from './download.ts'
import type { CatalogOptions } from './types.ts'
import type { InstalledCompanySkill, InstallLimits } from './install-types.ts'

type Generation = Branded<'uwork-company-skill-generation'>
const generationSchema = z.uuid().refine(value => value === value.toLowerCase())
  .transform(value => brandString<Generation>(value))
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
const versionManifest = z.object({
  format: z.literal(1), source: z.string(), generation: generationSchema,
  slug: z.string(), version: z.string().min(1).max(128), fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  files: z.array(z.object({ path: z.string(), sha256: digest, bytes: z.number().int().nonnegative() }).strict()),
}).strict()
const indexSchema = z.object({
  format: z.literal(1), source: z.string(),
  entries: z.array(z.object({
    slug: z.string(), enabled: z.boolean(), current: generationSchema, versions: z.array(generationSchema).min(1),
  }).strict()),
}).strict()
type Index = z.infer<typeof indexSchema>
type Manifest = z.infer<typeof versionManifest>

function absent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
function stateFailure(cause?: unknown): never {
  throw new RemoteError('uwork-company-market/state-invalid', 'Company skill installation state cannot be trusted', {}, { cause })
}
function summary(manifest: Manifest, enabled: boolean): InstalledCompanySkill {
  return { slug: manifest.slug, version: manifest.version, fingerprint: manifest.fingerprint, enabled, fileCount: manifest.files.length }
}

/** Installation owner; only its private store may be created, activated or cleaned. */
export class CompanyInstallStore {
  private readonly index: string
  private readonly versions: string
  private readonly staging: string

  constructor(private readonly root: string, private readonly options: CatalogOptions & InstallLimits, private readonly ctx: Context) {
    this.index = join(root, 'index.json')
    this.versions = join(root, 'versions')
    this.staging = join(root, 'staging')
  }

  private async directory(path: string): Promise<void> {
    await mkdir(path, { recursive: true, mode: 0o700 })
    const stat = await lstat(path)
    if (!stat.isDirectory()) stateFailure()
  }

  private async json(path: string): Promise<unknown> {
    const stat = await lstat(path)
    if (!stat.isFile() || stat.size > this.options.maxManifestBytes) stateFailure()
    const file = await open(path, 'r')
    try {
      const bytes = await file.readFile()
      if (bytes.length > this.options.maxManifestBytes) stateFailure()
      try { return JSON.parse(bytes.toString('utf8')) }
      catch (error) { return stateFailure(error) }
    } finally { await file.close() }
  }

  private async readIndex(): Promise<Index> {
    const parsed = indexSchema.safeParse(await this.json(this.index))
    if (!parsed.success || parsed.data.source !== this.options.baseUrl) stateFailure()
    const slugs = new Set<string>(), generations = new Set<string>()
    if (parsed.data.entries.length > this.options.maxInstalledSkills) stateFailure()
    for (const entry of parsed.data.entries) {
      try { if (skillIdentity(entry.slug).canonical !== entry.slug) stateFailure() }
      catch (error) { stateFailure(error) }
      if (slugs.has(entry.slug) || !entry.versions.includes(entry.current)) stateFailure()
      slugs.add(entry.slug)
      for (const id of entry.versions) {
        if (generations.has(id)) stateFailure()
        generations.add(id)
      }
    }
    if (generations.size > this.options.maxStoredVersions) stateFailure()
    return parsed.data
  }

  private async manifest(id: Generation, slug?: string): Promise<Manifest> {
    const folder = join(this.versions, id)
    const stat = await lstat(folder)
    if (!stat.isDirectory()) stateFailure()
    const parsed = versionManifest.safeParse(await this.json(join(folder, 'manifest.json')))
    if (!parsed.success || parsed.data.source !== this.options.baseUrl || parsed.data.generation !== id
      || (slug !== undefined && parsed.data.slug !== slug) || parsed.data.files.length > this.options.maxArchiveEntries) stateFailure()
    try { if (skillIdentity(parsed.data.slug).canonical !== parsed.data.slug) stateFailure() }
    catch (error) { stateFailure(error) }
    const content = await lstat(join(folder, 'skill'))
    if (!content.isDirectory()) stateFailure()
    const paths = new Set<string>()
    let bytes = 0
    for (const file of parsed.data.files) {
      try { portablePath(file.path, this.options.maxPathBytes) }
      catch (error) { stateFailure(error) }
      bytes += file.bytes
      if (file.bytes > this.options.maxFileBytes || bytes > this.options.maxExpandedBytes) stateFailure()
      const key = file.path.normalize('NFC').toLowerCase()
      if (paths.has(key)) stateFailure()
      paths.add(key)
    }
    if (!parsed.data.files.some(file => file.path === 'SKILL.md' && file.bytes > 0)) stateFailure()
    if (contentFingerprint(parsed.data.files) !== parsed.data.fingerprint) stateFailure()
    return parsed.data
  }

  private encode(value: unknown): string {
    const text = JSON.stringify(value, null, 2) + '\n'
    if (Buffer.byteLength(text) > this.options.maxManifestBytes) packageFailure('limit')
    return text
  }

  private async prepare(): Promise<void> {
    await this.directory(this.root)
    await this.directory(this.versions)
    await this.directory(this.staging)
  }

  /** Recover only owned, never-activated versions and abandoned staging while the writer lock is held. */
  private async recover(): Promise<Index> {
    let index: Index
    try { index = await this.readIndex() }
    catch (error) {
      if (!absent(error)) throw error
      if ((await readdir(this.versions)).length || (await readdir(this.staging)).length) stateFailure(error)
      index = { format: 1, source: this.options.baseUrl, entries: [] }
      await writeFileAtomic(this.index, this.encode(index), { mode: 0o600, dirMode: 0o700 })
    }
    const retained = new Set(index.entries.flatMap(entry => entry.versions))
    for (const name of await readdir(this.versions)) {
      const id = generationSchema.safeParse(name)
      if (!id.success || retained.has(id.data)) continue
      await this.manifest(id.data)
      await rm(join(this.versions, id.data), { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
    }
    for (const name of await readdir(this.staging)) {
      if (!generationSchema.safeParse(name).success) continue
      await rm(join(this.staging, name), { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
    }
    return index
  }

  /**
   * Read current installed versions after recovery; historical versions remain available to already-running work.
   * @param signal - service or caller cancellation.
   * @returns current installed summaries.
   */
  async list(signal: AbortSignal): Promise<InstalledCompanySkill[]> {
    await this.prepare()
    return await withFileLock(this.index, async () => {
      const index = await this.recover()
      const result: InstalledCompanySkill[] = []
      for (const entry of index.entries) result.push(summary(await this.manifest(entry.current, entry.slug), entry.enabled))
      return result
    }, { signal, waitMs: this.options.lockWaitMs })
  }

  /**
   * Download, verify and activate a version while preserving every previous committed version.
   * @param canonical - selected public skill slug.
   * @param version - exact published version.
   * @param signal - complete installation cancellation and deadline.
   * @returns the current installed version after an atomic index commit or a verified idempotent retry.
   */
  async install(canonical: string, version: string, signal: AbortSignal): Promise<InstalledCompanySkill> {
    const identity = skillIdentity(canonical)
    await this.prepare()
    const activation: { outcome: 'unchanged' | 'committed' | 'unknown' } = { outcome: 'unchanged' }
    try {
      return await withFileLock(this.index, async () => {
        const index = await this.recover()
        const previous = index.entries.find(entry => entry.slug === identity.canonical)
        if (previous === undefined && index.entries.length >= this.options.maxInstalledSkills) packageFailure('limit')
        const id = brandString<Generation>(randomUUID())
        const stage = join(this.staging, id)
        await mkdir(stage, { mode: 0o700 })
        let moved = false
        try {
          const resolved = await downloadPackage(this.options, identity.canonical, version, join(stage, 'archive.zip'), signal)
          const content = join(stage, 'version', 'skill')
          await mkdir(content, { recursive: true, mode: 0o700 })
          const files = await extractPackage(join(stage, 'archive.zip'), content, resolved.fingerprint, this.options, signal)
          await validateCompanyPackage(this.ctx, join(stage, 'version'), signal)
          if (previous !== undefined) {
            const old = await this.manifest(previous.current, previous.slug)
            if (old.version === version) {
              if (old.fingerprint !== resolved.fingerprint) packageFailure('fingerprint')
              return summary(old, previous.enabled)
            }
          }
          if (index.entries.reduce((sum, entry) => sum + entry.versions.length, 0) >= this.options.maxStoredVersions) packageFailure('limit')
          const manifest: Manifest = {
            format: 1, source: this.options.baseUrl, generation: id, slug: identity.canonical,
            version, fingerprint: resolved.fingerprint, files,
          }
          await writeFile(join(stage, 'version', 'manifest.json'), this.encode(manifest), { flag: 'wx', mode: 0o600 })
          signal.throwIfAborted()
          await rename(join(stage, 'version'), join(this.versions, id))
          moved = true
          signal.throwIfAborted()
          const next = {
            slug: identity.canonical, current: id, versions: [...previous?.versions ?? [], id], enabled: previous?.enabled ?? true,
          }
          index.entries = [...index.entries.filter(entry => entry.slug !== identity.canonical), next]
          try { await writeFileAtomic(this.index, this.encode(index), { mode: 0o600, dirMode: 0o700 }) }
          catch (error) {
            let observed: Index
            try { observed = await this.readIndex() }
            catch (readError) {
              activation.outcome = 'unknown'
              throw new RemoteError('uwork-company-market/install-failed', 'Company skill activation could not be confirmed', { outcome: 'unknown' }, { cause: new AggregateError([error, readError]) })
            }
            if (!observed.entries.some(entry => entry.current === id)) throw error
          }
          activation.outcome = 'committed'
          return summary(manifest, next.enabled)
        } catch (error) {
          if (moved && activation.outcome === 'unchanged') {
            await rm(join(this.versions, id), { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
          }
          throw error
        } finally { await rm(stage, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }) }
      }, { signal, waitMs: this.options.lockWaitMs })
    } catch (error) {
      if (error instanceof RemoteError && activation.outcome === 'unchanged') throw error
      throw new RemoteError('uwork-company-market/install-failed', 'Company skill installation did not finish normally', { outcome: activation.outcome }, { cause: error })
    }
  }

  /**
   * Read enabled immutable version roots for the skill provider.
   * @param signal - lookup and service lifetime.
   * @returns currently enabled generations with roots containing their skill directory.
   */
  async enabledRoots(signal: AbortSignal): Promise<readonly { slug: string; root: string }[]> {
    await this.prepare()
    signal.throwIfAborted()
    let index: Index
    try { index = await this.readIndex() }
    catch (error) {
      if (!absent(error)) throw error
      index = await withFileLock(this.index, async () => await this.recover(), { signal, waitMs: this.options.lockWaitMs })
    }
    const result: { slug: string; root: string }[] = []
    for (const entry of index.entries) {
      if (!entry.enabled) continue
      await this.manifest(entry.current, entry.slug)
      result.push({ slug: entry.slug, root: join(this.versions, entry.current) })
    }
    return result
  }

  /**
   * Enable, disable or uninstall only a company-owned installation.
   * @param slug - canonical installed skill slug.
   * @param enabled - next enabled state, or null to remove the installation.
   * @param signal - operation cancellation; an admitted index commit may complete.
   * @returns current installation summaries after the committed change.
   */
  async change(slug: string, enabled: boolean | null, signal: AbortSignal): Promise<InstalledCompanySkill[]> {
    const identity = skillIdentity(slug)
    await this.prepare()
    const activation: { outcome: 'unchanged' | 'committed' | 'unknown' } = { outcome: 'unchanged' }
    try {
      return await withFileLock(this.index, async () => {
        const index = await this.recover()
        const entry = index.entries.find(item => item.slug === identity.canonical)
        if (entry === undefined) return await this.summaries(index)
        if (enabled === null) index.entries = index.entries.filter(item => item !== entry)
        else entry.enabled = enabled
        signal.throwIfAborted()
        const encoded = this.encode(index)
        try { await writeFileAtomic(this.index, encoded, { mode: 0o600, dirMode: 0o700 }) }
        catch (error) {
          let observed: Index
          try { observed = await this.readIndex() }
          catch (readError) {
            activation.outcome = 'unknown'
            throw new AggregateError([error, readError])
          }
          if (this.encode(observed) !== encoded) throw error
        }
        activation.outcome = 'committed'
        // Retained immutable generations survive in-flight skill reads. Recovery
        // deletes unreferenced versions on a later store operation or restart.
        return await this.summaries(index)
      }, { signal, waitMs: this.options.lockWaitMs })
    } catch (error) {
      if (error instanceof RemoteError && activation.outcome === 'unchanged') throw error
      throw new RemoteError('uwork-company-market/install-failed', 'Company skill management did not finish normally', { outcome: activation.outcome }, { cause: error })
    }
  }

  private async summaries(index: Index): Promise<InstalledCompanySkill[]> {
    const result: InstalledCompanySkill[] = []
    for (const entry of index.entries) result.push(summary(await this.manifest(entry.current, entry.slug), entry.enabled))
    return result
  }

}
