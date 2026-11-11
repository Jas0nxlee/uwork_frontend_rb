/** Exact endpoint and canonical-ID matching for Models.dev. */
import { sanitizeMetadata, type CatalogMetadata } from './public-model-metadata.ts'

/** Sanitized public model entry with its canonical identifier. */
export interface CatalogModel extends CatalogMetadata {
  readonly id: string
  readonly canonical_model_id?: string
}
/** Sanitized public provider and its optional model-list endpoint. */
export interface CatalogProvider {
  readonly id: string
  readonly api?: string
  readonly models: Readonly<Record<string, CatalogModel>>
}
/** Public providers keyed by their validated IDs. */
export type CatalogData = Readonly<Record<string, CatalogProvider>>
/** One unambiguous provider and model match. */
export interface CatalogMatch {
  readonly providerId: string
  readonly model: CatalogModel
}
/** Validated catalog with conservative endpoint and canonical-ID lookup. */
export interface CatalogIndex {
  readonly data: CatalogData
  match(baseUrl: string, modelId: string): CatalogMatch | undefined
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
const id = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 512 ||
    /[\u0000-\u001f]/u.test(value)
  )
    throw new Error('Invalid catalog ID')
  return value.trim()
}
const key = (value: string) => value.trim().toLowerCase()
function endpoint(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return undefined
    return `${url.origin}${url.pathname.replace(/\/+$/, '').replace(/\/v1(?:beta)?$/, '')}`
  } catch {
    return undefined
  }
}

/** Parse the same whitelist for network and cached catalogs.
 * @param value - untrusted Models.dev response.
 * @returns sanitized catalog and exact-match lookup.
 */
export function parseCatalog(value: unknown): CatalogIndex {
  const input = record(value)
  if (!input || !Object.keys(input).length || Object.keys(input).length > 2000)
    throw new Error('Invalid catalog')
  const data: Record<string, CatalogProvider> = Object.create(null) as Record<string, CatalogProvider>
  const canonical = new Map<string, CatalogMatch[]>()
  const canonicalEvidence = new Map<string, CatalogMatch[]>()
  const byProvider = new Map<string, Map<string, CatalogMatch[]>>(),
    endpoints = new Map<string, string[]>()
  let count = 0
  for (const [providerKey, rawProvider] of Object.entries(input)) {
    const provider = record(rawProvider),
      rawModels = record(provider?.models)
    if (!provider || !rawModels) throw new Error('Invalid catalog provider')
    const providerId = id(provider.id ?? providerKey)
    if (key(providerId) !== key(providerKey)) throw new Error('Conflicting catalog provider')
    const models = Object.create(null) as Record<string, CatalogModel>
    const providerModels = byProvider.get(key(providerId)) ?? new Map<string, CatalogMatch[]>()
    byProvider.set(key(providerId), providerModels)
    const api =
      typeof provider.api === 'string' && endpoint(provider.api) ? provider.api : undefined
    const normalizedApi = api === undefined ? undefined : endpoint(api)
    if (normalizedApi !== undefined) {
      const normalized = normalizedApi
      endpoints.set(normalized, [...(endpoints.get(normalized) ?? []), key(providerId)])
    }
    for (const [modelKey, rawModel] of Object.entries(rawModels)) {
      if (++count > 30000) throw new Error('Catalog has too many models')
      const raw = record(rawModel)
      if (!raw) throw new Error('Invalid catalog model')
      const modelId = id(raw.id ?? modelKey)
      if (key(modelId) !== key(modelKey)) throw new Error('Conflicting catalog model')
      const canonicalId =
        raw.canonical_model_id === undefined ? undefined : id(raw.canonical_model_id)
      const model: CatalogModel = {
        id: modelId,
        ...(canonicalId ? { canonical_model_id: canonicalId } : {}),
        ...sanitizeMetadata(raw),
      }
      models[modelId] = model
      const match = { providerId, model }
      const normalized = key(modelId)
      providerModels.set(normalized, [...(providerModels.get(normalized) ?? []), match])
      if (canonicalId && key(canonicalId) === `${key(providerId)}/${normalized}`)
        canonical.set(normalized, [...(canonical.get(normalized) ?? []), match])
      if (canonicalId && key(canonicalId).endsWith(`/${normalized}`))
        canonicalEvidence.set(normalized, [...(canonicalEvidence.get(normalized) ?? []), match])
    }
    data[providerId] = { id: providerId, ...(api ? { api } : {}), models }
  }
  if (!count) throw new Error('Empty catalog')
  const single = (matches: readonly CatalogMatch[] | undefined) =>
    matches?.length === 1 ? matches[0] : undefined
  const consensus = (matches: readonly CatalogMatch[] | undefined) => {
    if (!matches || matches.length < 2) return undefined
    const first = matches[0]
    if (first === undefined) return undefined
    // Missing canonical records require agreement from multiple providers.
    const signature = JSON.stringify(first.model)
    return matches.every(item => JSON.stringify(item.model) === signature) ? first : undefined
  }
  return {
    data,
    match(baseUrl, modelId) {
      const normalized = key(modelId),
        normalizedEndpoint = endpoint(baseUrl)
      const candidates = normalizedEndpoint ? endpoints.get(normalizedEndpoint) : undefined
      if (candidates?.length) {
        if (candidates.length !== 1) return undefined
        const providerId = candidates[0]
        if (providerId === undefined) return undefined
        const models = byProvider.get(providerId)
        const prefix = `${candidates[0]}/`
        return (
          single(models?.get(normalized)) ??
          (normalized.startsWith(prefix)
            ? single(models?.get(normalized.slice(prefix.length)))
            : undefined)
        )
      }
      const slash = normalized.indexOf('/')
      if (slash > 0) {
        const provider = byProvider.get(normalized.slice(0, slash))
        if (provider)
          return (
            single(provider.get(normalized)) ?? single(provider.get(normalized.slice(slash + 1)))
          )
      }
      // Unqualified aliases require canonical evidence.
      return single(canonical.get(normalized)) ?? consensus(canonicalEvidence.get(normalized))
    },
  }
}
