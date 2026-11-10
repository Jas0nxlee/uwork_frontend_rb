/** Request metadata exposed to pi-ai transport-header and lifetime contributors. */

import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { LlmModelDiscoveryRequest } from '@deepseek-ai/dsh-llm'

/** Model-discovery routing facts without the one-shot credential. */
export type PiAiDiscoveryContext = Readonly<Pick<LlmModelDiscoveryRequest, 'provider' | 'baseURL' | 'api'>>

/** Model-hidden routing metadata from the exact prepared adapter call. */
export interface PiAiRequestHeaderContext extends Readonly<Pick<GenerateOptions<string>,
  'provider' | 'model' | 'sessionId' | 'purpose'>> {
  /** Resolved endpoint of the model selected for this call. */
  readonly baseURL: string
}
