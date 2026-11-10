/** Bind a public skill/version to its same-origin package and stream it into owned staging. */
import { open } from 'node:fs/promises'
import { z } from 'zod'
import { discoverApi, marketJson, marketResponse } from './transport.ts'
import { packageFailure } from './archive.ts'
import type { CatalogOptions } from './types.ts'

const component = z.string().min(1).max(256).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u)
const versionSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/u)

/** Normalized public SkillHub identity; global skills use their bare canonical slug. */
export interface SkillIdentity {
  /** Bare global slug, or namespace--slug. */
  readonly canonical: string
  /** Published namespace, including global. */
  readonly namespace: string
  /** Namespace-local published slug. */
  readonly slug: string
}

/**
 * Validate and split a canonical SkillHub slug without admitting path components.
 * @param canonical - global slug or namespace--slug.
 * @returns normalized identity used for requests and installation keys.
 */
export function skillIdentity(canonical: string): SkillIdentity {
  if (!component.safeParse(canonical).success) packageFailure('identity')
  const split = canonical.indexOf('--')
  const namespace = split < 0 ? 'global' : canonical.slice(0, split)
  const slug = split < 0 ? canonical : canonical.slice(split + 2)
  if (!component.safeParse(namespace).success || !component.safeParse(slug).success) packageFailure('identity')
  return { namespace, slug, canonical: namespace === 'global' ? slug : `${namespace}--${slug}` }
}

/**
 * Resolve and download exactly one public version; the server cannot redirect this operation to another resource.
 * @param options - normalized source, JSON limit and compressed-byte limit.
 * @param canonical - selected canonical slug.
 * @param version - exact selected version.
 * @param destination - exclusively created archive path within owned staging.
 * @param signal - installation lifetime.
 * @returns the verified resolver identity and expected content fingerprint.
 */
export async function downloadPackage(
  options: CatalogOptions & { readonly maxArchiveBytes: number },
  canonical: string, version: string, destination: string, signal: AbortSignal,
): Promise<{ readonly identity: SkillIdentity; readonly fingerprint: string }> {
  const identity = skillIdentity(canonical)
  if (!versionSchema.safeParse(version).success) packageFailure('version')
  const api = await discoverApi(options, signal)
  const skill = `${api}/skills/${encodeURIComponent(identity.namespace)}/${encodeURIComponent(identity.slug)}`
  const response = await marketJson(`${skill}/resolve?version=${encodeURIComponent(version)}`, options, signal)
  const parsed = z.object({ code: z.literal(0), data: z.object({
    namespace: component, slug: component, version: versionSchema,
    fingerprint: z.string().regex(/^(?:sha256:)?[a-fA-F0-9]{64}$/u), downloadUrl: z.string().min(1).max(4096),
  }) }).safeParse(response)
  if (!parsed.success) packageFailure('identity')
  if (parsed.data.data.namespace !== identity.namespace || parsed.data.data.slug !== identity.slug) packageFailure('identity')
  if (parsed.data.data.version !== version) packageFailure('version')
  const expected = `${skill}/versions/${encodeURIComponent(version)}/download`
  const declared = parsed.data.data.downloadUrl
  let admitted: boolean
  let candidates: string[]
  try {
    if (declared.startsWith('/') && !declared.startsWith('//')) {
      const source = new URL(options.baseUrl)
      candidates = [new URL(declared, source.origin).href, new URL(source.pathname.replace(/\/+$/u, '') + declared, source.origin).href]
    } else if (/^https?:\/\//u.test(declared)) candidates = [new URL(declared).href]
    else return packageFailure('identity')
    const target = new URL(expected)
    const expectedParts = target.pathname.split('/').map(part => decodeURIComponent(part))
    admitted = candidates.some((candidate) => {
      const url = new URL(candidate)
      if (url.origin !== target.origin || url.username || url.password || url.search || url.hash) return false
      const parts = url.pathname.split('/')
      return parts.length === expectedParts.length && parts.every((part, index) => decodeURIComponent(part) === expectedParts[index])
    })
  } catch (error) { void error; return packageFailure('identity') }
  if (!admitted) packageFailure('identity')
  const archive = await marketResponse(expected, signal)
  if (archive.body === null) packageFailure('format')
  const reader = archive.body.getReader()
  try {
    const output = await open(destination, 'wx', 0o600)
    let bytes = 0
    try {
      for (;;) {
        signal.throwIfAborted()
        const part = await reader.read()
        if (part.done) break
        bytes += part.value.byteLength
        if (bytes > options.maxArchiveBytes) packageFailure('limit')
        await output.writeFile(part.value)
      }
    } finally { await output.close() }
  } finally {
    try { await reader.cancel() }
    catch (error) { void error /* An earlier read/abort failure remains authoritative; cancellation still settles. */ }
    reader.releaseLock()
  }
  return { identity, fingerprint: `sha256:${parsed.data.data.fingerprint.replace(/^sha256:/u, '').toLowerCase()}` }
}
