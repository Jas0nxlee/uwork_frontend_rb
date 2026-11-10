/** Safe view data and resource registration for enterprise usage. */
import type { OverviewState, UsageState } from '@deepseek-ai/dsh-uwork-gateway-service/types'

/** Identity withdrawal clears rendered account data before another read starts. */
export type UsagePageData = { readonly status: 'signed-out' | 'loading' | 'unavailable' } |
  { readonly status: 'ready'; readonly overview: OverviewState; readonly usage: UsageState }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    /** Current enterprise usage and quota; credentials never enter this resource. */
    'uwork-usage': UsagePageData
  }
}
