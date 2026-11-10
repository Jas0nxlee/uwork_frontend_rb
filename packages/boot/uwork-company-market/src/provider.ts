/** Company-owned installed content projected through the native filesystem skill parser. */
import type { Context } from '@deepseek-ai/cordis'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import type { SkillCandidate, SkillDefinition, SkillLookupOptions, SkillProvider, SkillProviderControl, SkillProviderObservation } from '@deepseek-ai/dsh-skill'
import { packageFailure } from './archive.ts'
import type { CompanyInstallStore } from './install-store.ts'

interface CompanyLocator { readonly root: string; readonly original: SkillCandidate }

/** Exposes enabled generations without scanning personal or default skill directories. */
export class CompanySkillProvider implements SkillProvider {
  /** Registry owner for company-installed skill candidates. */
  readonly name = 'uwork-company-market'

  constructor(private readonly ctx: Context, private readonly store: CompanyInstallStore, private readonly control: SkillProviderControl) {}

  /**
   * Discover enabled company skills using the native frontmatter and invocation rules.
   * @param options - lookup cancellation and workspace context.
   * @returns company candidates; personal filesystem ranks continue to win duplicate names.
   */
  async list(options: SkillLookupOptions): Promise<readonly SkillCandidate[] | SkillProviderObservation> {
    const signal = AbortSignal.any([this.control.signal, ...options.signal === undefined ? [] : [options.signal]])
    const roots = await this.store.enabledRoots(signal)
    const candidates: SkillCandidate[] = []
    let complete = true
    for (const { root } of roots) {
      const lifecycle = new AbortController()
      const filesystem = new FileSystemSkillProvider(this.ctx, { signal: lifecycle.signal, invalidate: this.control.invalidate }, {
        providerName: this.name, includeDefaultRoots: false, bundledSkillDir: root, watch: false,
      })
      try {
        const observation = await filesystem.list({ ...options, signal })
        const entries = Array.isArray(observation) ? observation : observation.candidates
        if (!Array.isArray(observation) && !observation.complete) complete = false
        for (const original of entries) {
          const candidate: SkillCandidate = { ...original, source: 'company-market', locator: { root, original } satisfies CompanyLocator }
          candidates.push(candidate)
        }
      } finally { lifecycle.abort(); await filesystem.dispose() }
    }
    return complete ? candidates : { candidates, complete }
  }

  /**
   * Read the same immutable generation selected by discovery while it remains enabled.
   * @param candidate - a candidate returned by this provider.
   * @param options - lookup cancellation and workspace context.
   * @returns the native parsed body, or undefined after disable, replacement or uninstall.
   */
  async get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    // SkillProvider passes back this provider's exact opaque locator.
    const owner = candidate.locator as CompanyLocator
    const signal = AbortSignal.any([this.control.signal, ...options.signal === undefined ? [] : [options.signal]])
    if (!(await this.store.enabledRoots(signal)).some(entry => entry.root === owner.root)) return undefined
    const lifecycle = new AbortController()
    const filesystem = new FileSystemSkillProvider(this.ctx, { signal: lifecycle.signal, invalidate: this.control.invalidate }, {
      providerName: this.name, includeDefaultRoots: false, bundledSkillDir: owner.root, watch: false,
    })
    try {
      const definition = await filesystem.get(owner.original, { ...options, signal })
      return definition === undefined ? undefined : { ...definition, source: 'company-market' }
    } finally { lifecycle.abort(); await filesystem.dispose() }
  }
}


/**
 * Require one native-loadable instruction before activating downloaded content.
 * @param ctx - installation owner's context for native filesystem diagnostics.
 * @param root - verified staged generation containing its skill directory.
 * @param signal - installation lifetime.
 */
export async function validateCompanyPackage(ctx: Context, root: string, signal: AbortSignal): Promise<void> {
  const lifetime = new AbortController()
  const filesystem = new FileSystemSkillProvider(ctx, { signal: lifetime.signal,
    /* v8 ignore next -- Validation disables watchers; the parser never requests invalidation. */
    invalidate: () => {},
  }, {
    providerName: 'uwork-company-market-validation', includeDefaultRoots: false, bundledSkillDir: root, watch: false,
  })
  try {
    const observation = await filesystem.list({ signal })
    const candidates = Array.isArray(observation) ? observation : observation.candidates
    if (!Array.isArray(observation) && !observation.complete) packageFailure('format')
    const [candidate, ...others] = candidates
    if (candidate === undefined || others.length > 0) packageFailure('format')
    const definition = await filesystem.get(candidate, { signal })
    if (definition === undefined || !definition.content.trim()) packageFailure('format')
  } finally { lifetime.abort(); await filesystem.dispose() }
}
