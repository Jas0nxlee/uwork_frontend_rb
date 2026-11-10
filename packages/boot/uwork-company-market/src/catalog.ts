/** Bounded anonymous SkillHub discovery and complete-catalog pagination. */
import { z } from 'zod'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { CatalogOptions, CompanySkill } from './types.ts'
import { discoverApi, marketJson } from './transport.ts'

const slug = z.string().min(1).max(256).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u)
const item = z.object({
  slug,
  displayName: z.string().min(1).max(512),
  summary: z.string().max(8192),
  latestVersion: z.object({ version: z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/u) }),
})
const pageSchema = z.object({
  items: z.array(item),
  nextCursor: z.union([z.null(), z.number().int().nonnegative(), z.string().regex(/^(?:0|[1-9][0-9]*)$/u)]),
})

function invalid(): never {
  throw new RemoteError('uwork-company-market/unavailable', 'Invalid company market response', { reason: 'invalid' })
}

/**
 * Normalize the configured source before any request; HTTP is restricted to loopback deployments.
 * @param value - deployment-configured SkillHub root.
 * @returns canonical source without trailing slashes.
 */
export function normalizeSource(value: string): string {
  const url = new URL(value)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    || url.username || url.password || url.search || url.hash) {
    throw new Error('Company market requires HTTPS without credentials, query or fragment')
  }
  return url.href.replace(/\/+$/u, '')
}

/**
 * Read every declared page or refuse the incomplete catalog; redirects and cross-origin discovery are rejected.
 * @param options - normalized source and bounded deployment limits.
 * @param signal - invocation deadline and service lifetime.
 * @returns unique public skills in source order.
 */
export async function readCatalog(options: CatalogOptions, signal: AbortSignal): Promise<CompanySkill[]> {
  const apiBase = await discoverApi(options, signal)
  const items: CompanySkill[] = []
  const seen = new Set<string>()
  const pages = new Set<number>()
  let page = 0
  for (let count = 0; count < options.maxPages; count++) {
    signal.throwIfAborted()
    pages.add(page)
    const url = new URL(`${apiBase}/skills`)
    url.search = new URLSearchParams({ page: String(page), limit: String(options.upstreamPageSize) }).toString()
    const parsed = pageSchema.safeParse(await marketJson(url.href, options, signal))
    if (!parsed.success) invalid()
    for (const skill of parsed.data.items) {
      if (seen.has(skill.slug)) invalid()
      if (items.length >= options.maxItems) {
        throw new RemoteError('uwork-company-market/unavailable', 'Company market catalog exceeds its limit', { reason: 'limit' })
      }
      seen.add(skill.slug)
      items.push({ slug: skill.slug, title: skill.displayName, summary: skill.summary, version: skill.latestVersion.version })
    }
    if (parsed.data.nextCursor === null) return items
    const next = Number(parsed.data.nextCursor)
    if (!Number.isSafeInteger(next) || pages.has(next)) invalid()
    page = next
  }
  throw new RemoteError('uwork-company-market/unavailable', 'Company market pagination exceeds its limit', { reason: 'limit' })
}
