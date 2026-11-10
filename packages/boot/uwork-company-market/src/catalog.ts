/** Bounded anonymous SkillHub discovery and complete-catalog pagination. */
import { z } from 'zod'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { CatalogOptions, CompanySkill } from './types.ts'

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
const discoverySchema = z.object({ apiBase: z.string().min(1).max(2048) })

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

async function readJson(url: string, options: CatalogOptions, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, redirect: 'error', credentials: 'omit', headers: { accept: 'application/json' } })
  if (!response.ok) {
    await response.body?.cancel()
    const status = response.status
    const reason = status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 429 ? 'rate-limited' : 'http'
    throw new RemoteError('uwork-company-market/unavailable', 'Company market request failed', { reason, status })
  }
  if (response.body === null) invalid()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > options.maxResponseBytes) {
        await reader.cancel()
        throw new RemoteError('uwork-company-market/unavailable', 'Company market response exceeds its limit', { reason: 'limit' })
      }
      chunks.push(part.value)
    }
  } finally { reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch (error) {
    // Parsing owns this failure; response contents never enter diagnostics.
    void error
    return invalid()
  }
}

/**
 * Read every declared page or refuse the incomplete catalog; redirects and cross-origin discovery are rejected.
 * @param options - normalized source and bounded deployment limits.
 * @param signal - invocation deadline and service lifetime.
 * @returns unique public skills in source order.
 */
export async function readCatalog(options: CatalogOptions, signal: AbortSignal): Promise<CompanySkill[]> {
  const discovery = discoverySchema.safeParse(await readJson(`${options.baseUrl}/.well-known/clawhub.json`, options, signal))
  if (!discovery.success) invalid()
  let api: URL
  try { api = new URL(discovery.data.apiBase, `${options.baseUrl}/`) }
  catch (error) {
    // The discovery document, rather than the network transport, supplied this URL.
    void error
    return invalid()
  }
  if (api.origin !== new URL(options.baseUrl).origin || api.username || api.password || api.search || api.hash) invalid()
  const apiBase = api.href.replace(/\/+$/u, '')
  const items: CompanySkill[] = []
  const seen = new Set<string>()
  const pages = new Set<number>()
  let page = 0
  for (let count = 0; count < options.maxPages; count++) {
    signal.throwIfAborted()
    pages.add(page)
    const url = new URL(`${apiBase}/skills`)
    url.search = new URLSearchParams({ page: String(page), limit: String(options.upstreamPageSize) }).toString()
    const parsed = pageSchema.safeParse(await readJson(url.href, options, signal))
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
