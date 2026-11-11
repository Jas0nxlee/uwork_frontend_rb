/** Resolve custom model capabilities before committing a provider draft. */
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelDraft, ProbeTarget } from './ModelListEditor.tsx'
import type { ModelsOperations } from './operations.ts'
import type { ModelsKey } from './locales.ts'

/** Translate disclosed provider effort values into native pi-ai level mappings.
 * @param levels - exact provider effort values, false for unsupported, or undefined when undisclosed.
 * @returns a native reasoning declaration, without inventing undisclosed levels.
 */
export function discoveredReasoningEfforts(levels: LlmDiscoveredModel['reasoningLevels']): false | Record<string, string> | undefined {
  if (levels === undefined || (levels !== false && levels.length === 0)) return undefined
  if (levels === false) return false
  const supported = levels.filter(level => ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(level))
  if (!supported.some(level => level !== 'none')) return undefined
  return Object.fromEntries(supported.map(level => [level === 'none' ? 'off' : level, level]))
}

/** Resolve every selected model without forwarding credentials to the public directory.
 * @param operations - Host discovery operations.
 * @param probe - draft provider address and protocol.
 * @param models - selected model IDs and unrelated per-model settings.
 * @param t - localized failure copy.
 * @returns complete model rows or an actionable failure; never partial rows.
 */
export async function resolveModelMetadata(
  operations: ModelsOperations, probe: ProbeTarget, models: readonly ModelDraft[], t: (key: ModelsKey) => string,
): Promise<{ models: ModelDraft[]; error?: never } | { error: string; models?: never }> {
  const ids = models.map(model => String(model.id))
  const answer = await operations.discoverModels(probe.settingsNs, {
    ...probe.provider === undefined ? {} : { provider: probe.provider },
    ...probe.baseURL === undefined ? {} : { baseURL: probe.baseURL },
    ...probe.api === undefined ? {} : { api: probe.api },
    modelIds: ids,
  })
  if (answer.kind === 'refused') return { error: answer.message }
  const found = new Map(answer.models.map(model => [model.id, model]))
  const missing: string[] = []
  const resolved: ModelDraft[] = []
  for (const model of models) {
    const metadata = found.get(String(model.id))
    if (metadata?.contextWindow === undefined || metadata.maxTokens === undefined
      || !metadata.inputModalities?.includes('text')) {
      missing.push(String(model.id))
    } else {
      const reasoningEfforts = discoveredReasoningEfforts(metadata.reasoningLevels)
      resolved.push({ ...model, contextWindow: metadata.contextWindow,
        maxTokens: metadata.maxTokens, input: [...metadata.inputModalities],
        ...reasoningEfforts === undefined ? {} : { reasoningEfforts } })
    }
  }
  return missing.length > 0
    ? { error: t('metadataMissing').replace('{models}', () => missing.join(', ')) }
    : { models: resolved }
}
