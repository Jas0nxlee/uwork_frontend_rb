/** Validation of Models.dev capability records. */
export interface CatalogMetadata {
  readonly limit?: { readonly context?: number; readonly output?: number }
  readonly modalities?: { readonly input?: readonly string[]; readonly output?: readonly string[] }
  readonly reasoning?: boolean
  readonly reasoning_options?: readonly {
    readonly type: 'effort'
    readonly values: readonly string[]
  }[]
  readonly tool_call?: boolean
  readonly structured_output?: boolean
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
const effortOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const boolean = (value: unknown): boolean | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error('Invalid catalog capability')
  return value
}
const tokens = (value: unknown): number | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid catalog token limit')
  return value
}
const modalities = (value: unknown): readonly string[] | undefined => {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length > 128))
    throw new Error('Invalid catalog modalities')
  return [...new Set(value as string[])]
}

/** Retain only public capability fields; discard pricing and remote request templates.
 * @param value - untrusted network or cached model record.
 * @returns validated model capabilities.
 */
export function sanitizeMetadata(value: unknown): CatalogMetadata {
  const data = record(value)
  if (!data) throw new Error('Invalid catalog model')
  const limit = record(data.limit)
  const modes = record(data.modalities)
  if ((data.limit !== undefined && !limit) || (data.modalities !== undefined && !modes))
    throw new Error('Invalid catalog model metadata')
  const context = tokens(limit?.context),
    output = tokens(limit?.output)
  const inputModes = modalities(modes?.input),
    outputModes = modalities(modes?.output)
  const reasoning = boolean(data.reasoning),
    toolCall = boolean(data.tool_call),
    structured = boolean(data.structured_output)
  let efforts: string[] = []
  if (data.reasoning_options !== undefined) {
    if (!Array.isArray(data.reasoning_options))
      throw new Error('Invalid catalog reasoning options')
    for (const option of data.reasoning_options) {
      const item = record(option)
      if (item?.type !== 'effort') continue
      if (!Array.isArray(item.values) || item.values.some(level => typeof level !== 'string'))
        throw new Error('Invalid catalog reasoning efforts')
      efforts.push(...(item.values as string[]).filter(level => effortOrder.includes(level)))
    }
  }
  efforts = effortOrder.filter(level => efforts.includes(level))
  return {
    ...(context !== undefined || output !== undefined
      ? {
        limit: {
          ...(context !== undefined ? { context } : {}),
          ...(output !== undefined ? { output } : {}),
        },
      }
      : {}),
    ...(inputModes !== undefined || outputModes !== undefined
      ? {
        modalities: {
          ...(inputModes ? { input: inputModes } : {}),
          ...(outputModes ? { output: outputModes } : {}),
        },
      }
      : {}),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(efforts.length ? { reasoning_options: [{ type: 'effort', values: efforts }] } : {}),
    ...(toolCall === undefined ? {} : { tool_call: toolCall }),
    ...(structured === undefined ? {} : { structured_output: structured }),
  }
}
