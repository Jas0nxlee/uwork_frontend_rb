/** Anonymous, bounded SkillHub transport shared by catalog and content operations. */
import { z } from 'zod'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { CatalogOptions } from './types.ts'

/**
 * Open one anonymous request, refusing redirects and non-success statuses.
 * @param url - URL admitted by the configured source's operation.
 * @param signal - complete operation lifetime and deadline.
 * @returns response whose body the caller owns.
 */
export async function marketResponse(url: string, signal: AbortSignal): Promise<Response> {
  const response = await fetch(url, { signal, redirect: 'error', credentials: 'omit', headers: { accept: 'application/json, application/zip' } })
  if (!response.ok) {
    await response.body?.cancel()
    const status = response.status
    const reason = status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 429 ? 'rate-limited' : 'http'
    throw new RemoteError('uwork-company-market/unavailable', 'Company market request failed', { reason, status })
  }
  return response
}

/**
 * Read a bounded JSON response without retaining untrusted response text in diagnostics.
 * @param url - admitted operation URL.
 * @param options - source and response-byte limit.
 * @param signal - operation lifetime.
 * @returns parsed external JSON, awaiting the caller's schema validation.
 */
export async function marketJson(url: string, options: CatalogOptions, signal: AbortSignal): Promise<unknown> {
  const response = await marketResponse(url, signal)
  if (response.body === null) {
    throw new RemoteError('uwork-company-market/unavailable', 'Missing company market response', { reason: 'invalid' })
  }
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
    // Response text can contain private diagnostics even on a public endpoint.
    void error
    throw new RemoteError('uwork-company-market/unavailable', 'Invalid company market response', { reason: 'invalid' })
  }
}

/**
 * Discover an API on the configured source's origin, without URL credentials, query or fragment.
 * @param options - normalized source and response limits.
 * @param signal - operation lifetime.
 * @returns canonical API root without trailing slashes.
 */
export async function discoverApi(options: CatalogOptions, signal: AbortSignal): Promise<string> {
  const parsed = z.object({ apiBase: z.string().min(1).max(2048) })
    .safeParse(await marketJson(`${options.baseUrl}/.well-known/clawhub.json`, options, signal))
  const invalid = (): never => {
    throw new RemoteError('uwork-company-market/unavailable', 'Invalid company market discovery', { reason: 'invalid' })
  }
  if (!parsed.success) return invalid()
  let api: URL
  try { api = new URL(parsed.data.apiBase, `${options.baseUrl}/`) }
  catch (error) { void error; return invalid() }
  if (api.origin !== new URL(options.baseUrl).origin || api.username || api.password || api.search || api.hash) invalid()
  return api.href.replace(/\/+$/u, '')
}
