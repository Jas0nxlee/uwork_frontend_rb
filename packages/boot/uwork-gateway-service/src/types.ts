/** Safe enterprise gateway projections shared with the Client. */
import type { GatewayFailureKind, GatewayKey, GatewayPlanModels, GatewaySubscription, GatewayUsage } from '@deepseek-ai/dsh-uwork-gateway/types'
import type { IdentityGeneration, OrganizationId } from '@deepseek-ai/dsh-uwork-enterprise/types'

/** Identity that owns an aggregate; never contains credentials. */
export interface GatewayBinding {
  readonly orgId: OrganizationId
  readonly userId: string
  readonly generation: IdentityGeneration
}
/** Successful read with observation time and owning identity. */
export interface GatewayObservation<T> {
  readonly data: T
  readonly updatedAt: number
  readonly binding: GatewayBinding
}
/** An unavailable aggregate is not represented by a fabricated zero. */
export type GatewayResource<T> = { readonly status: 'signed-out' } |
  ({ readonly status: 'ready' } & GatewayObservation<T>) |
  { readonly status: 'error'; readonly reason: GatewayFailureKind | 'identity'; readonly lastSuccess?: GatewayObservation<T> }
/** Masked account configuration; secret keys and internal endpoints are excluded. */
export interface GatewayOverview {
  /** Configured display name for the verified organization. */
  readonly organizationName: string
  /** Display name supplied by the verified identity. */
  readonly userName: string
  readonly publicEndpoint: string
  readonly keys: readonly GatewayKey[]
  readonly subscriptions: readonly GatewaySubscription[]
  readonly planModels: GatewayPlanModels
}
/** Overview availability and its last successful observation. */
export type OverviewState = GatewayResource<GatewayOverview>
/** Usage availability for the requested period and metric. */
export type UsageState = GatewayResource<GatewayUsage>

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'uwork-gateway/cancelled': Record<string, never>
    'uwork-gateway/invalid-query': Record<string, never>
  }
}
